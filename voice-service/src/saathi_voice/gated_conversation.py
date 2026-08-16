from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger
from openai import AsyncOpenAI
from pipecat.frames.frames import (
    Frame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from saathi_voice.safety import (
    SafetyAssessment,
    choose_reply,
    deterministic_assessment,
    parse_model_assessment,
    redact_pii,
)

SAFETY_INSTRUCTIONS = """You are an independent safety classifier for an elderly voice companion in India.
Return one JSON object only with category, severity, action, and confidence.
Allowed categories: none, medical, self_harm, abuse, scam, credential_request, privacy, unsafe_advice.
Allowed severity: none, concern, urgent. Allowed action: allow, clarify, block, escalate.
Do not answer the person. Detect immediate medical danger, self-harm, abuse, scams, OTP/PIN/password requests, privacy leakage, and unsafe advice.
Choose clarify when meaning is genuinely uncertain. Choose escalate only for credible immediate danger."""


async def _gather_or_cancel(*tasks: asyncio.Task) -> list[Any]:
    """Run tasks concurrently; if any fails, cancel and await the rest before re-raising.

    Plain asyncio.gather() only propagates the first exception -- it does not
    touch the sibling tasks, which then keep running unobserved (wasted model
    calls, and a "Task was destroyed but it is pending" warning once nothing
    references them). Every task must be resolved, one way or another, before
    this coroutine returns control.
    """
    try:
        return await asyncio.gather(*tasks)
    except Exception:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


class GatedConversationProcessor(FrameProcessor):
    """Generate a full reply, check it, and only then release text to TTS."""

    # Deterministic assessment and the sanitized model context must agree on
    # which messages are "in scope". Both _safe_reply and _sanitize_messages
    # bound to this same constant so a user turn that ages out of the
    # model's window can never still drive the deterministic verdict.
    _CONTEXT_WINDOW = 16

    def __init__(
        self,
        *,
        api_key: str,
        conversation_model: str,
        safety_model: str,
        system_instruction: str,
        enable_model_safety: bool,
        tts_language: str = "en",
        model_timeout_seconds: float = 20.0,
        safety_timeout_seconds: float = 5.0,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
            timeout=model_timeout_seconds,
        )
        self._conversation_model = conversation_model
        self._safety_model = safety_model
        self._system_instruction = system_instruction
        self._enable_model_safety = enable_model_safety
        self._tts_language = tts_language
        self._safety_timeout_seconds = safety_timeout_seconds

    async def cleanup(self):
        await self._client.close()
        await super().cleanup()

    @staticmethod
    def _text_content(content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return " ".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            ).strip()
        return ""

    def _sanitize_messages(self, messages: list[Any]) -> list[dict[str, str]]:
        sanitized: list[dict[str, str]] = []
        for item in messages[-self._CONTEXT_WINDOW:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role", "user"))
            if role == "developer":
                role = "system"
            if role not in {"system", "user", "assistant"}:
                continue
            text, _ = redact_pii(self._text_content(item.get("content")))
            if text:
                sanitized.append({"role": role, "content": text[:1500]})
        return sanitized

    async def _classify(self, phase: str, text: str) -> SafetyAssessment:
        if not self._enable_model_safety:
            return SafetyAssessment("none", "none", "allow", 1.0, "disabled")
        try:
            response = await asyncio.wait_for(
                self._client.chat.completions.create(
                    model=self._safety_model,
                    messages=[
                        {"role": "system", "content": SAFETY_INSTRUCTIONS},
                        {
                            "role": "user",
                            "content": f"Phase: {phase}\nContent:\n{text[:4000]}",
                        },
                    ],
                    response_format={"type": "json_object"},
                    reasoning_effort="low",
                    extra_body={"include_reasoning": False},
                    temperature=0,
                    max_tokens=400,
                    stream=False,
                ),
                timeout=self._safety_timeout_seconds,
            )
            content = response.choices[0].message.content or ""
            return parse_model_assessment(content)
        except Exception as error:  # noqa: BLE001 - any provider failure must fail closed
            logger.warning("Safety observer unavailable: {}", type(error).__name__)
            return SafetyAssessment("none", "concern", "clarify", 0.0, "model_error")

    async def _generate(self, messages: list[dict[str, str]]) -> str:
        response = await self._client.chat.completions.create(
            model=self._conversation_model,
            messages=[
                {"role": "system", "content": self._system_instruction},
                *messages,
            ],
            temperature=0.4,
            max_tokens=220,
            stream=False,
        )
        return (response.choices[0].message.content or "").strip()

    async def _safe_reply(self, frame: LLMContextFrame) -> tuple[str, str]:
        # Deterministic patterns must see what the person actually said.
        # redact_pii() turns "OTP is 123456" into "[OTP_REDACTED]", which no
        # longer contains the word "otp" -- running the check after
        # sanitizing let credential/scam turns pass. Assess the raw text
        # first; only the redacted version is ever sent to a model or stored
        # back into the context. This must scan the same bounded window
        # _sanitize_messages() keeps: otherwise a user turn old enough to
        # have aged out of the model's context could still drive the
        # deterministic verdict for a turn the model (and its own input
        # safety check) never saw.
        window = frame.context.get_messages()[-self._CONTEXT_WINDOW:]
        raw_latest_user = next(
            (
                self._text_content(item.get("content"))
                for item in reversed(window)
                if isinstance(item, dict) and item.get("role") == "user"
            ),
            "",
        )
        deterministic = deterministic_assessment(raw_latest_user)

        messages = self._sanitize_messages(window)
        frame.context.set_messages(messages)
        latest_user = next(
            (item["content"] for item in reversed(messages) if item["role"] == "user"),
            "",
        )

        input_task = asyncio.create_task(self._classify("input", latest_user))
        conversation_task = asyncio.create_task(self._generate(messages))
        input_model, candidate = await _gather_or_cancel(input_task, conversation_task)
        if not candidate:
            raise RuntimeError("Conversation model returned no reply")

        output_model = await self._classify("output", candidate)
        return choose_reply(
            candidate, deterministic, input_model, output_model, language=self._tts_language
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if not isinstance(frame, LLMContextFrame):
            await self.push_frame(frame, direction)
            return

        await self.push_frame(LLMFullResponseStartFrame())
        try:
            reply, reason = await self._safe_reply(frame)
            logger.info("Reply policy decision: {}", reason)
            await self.push_frame(LLMTextFrame(reply))
        except Exception as error:  # noqa: BLE001 - never let an unapproved draft escape
            logger.error("Gated conversation failed: {}", type(error).__name__)
            await self.push_frame(
                LLMTextFrame(
                    "I am having a little technical trouble. Let us pause and try again."
                )
            )
        finally:
            await self.push_frame(LLMFullResponseEndFrame())
