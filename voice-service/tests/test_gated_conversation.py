import asyncio
from typing import Any

import pytest

from saathi_voice.gated_conversation import GatedConversationProcessor, _gather_or_cancel
from saathi_voice.safety import SafetyAssessment


class _FakeContext:
    """Minimal stand-in for pipecat's LLMContext -- just get/set messages."""

    def __init__(self, messages: list[dict[str, Any]]):
        self._messages = messages

    def get_messages(self) -> list[dict[str, Any]]:
        return self._messages

    def set_messages(self, messages: list[dict[str, Any]]) -> None:
        self._messages = messages


class _FakeFrame:
    def __init__(self, context: _FakeContext):
        self.context = context


def _processor(**overrides: Any) -> GatedConversationProcessor:
    kwargs: dict[str, Any] = {
        "api_key": "test-key",
        "conversation_model": "test-conversation-model",
        "safety_model": "test-safety-model",
        "system_instruction": "You are a test companion.",
        "enable_model_safety": True,
    }
    kwargs.update(overrides)
    return GatedConversationProcessor(**kwargs)


def test_gather_or_cancel_returns_all_results_on_success():
    async def run():
        async def value(n):
            return n

        results = await _gather_or_cancel(
            asyncio.create_task(value(1)), asyncio.create_task(value(2))
        )
        assert results == [1, 2]

    asyncio.run(run())


def test_gather_or_cancel_cancels_sibling_task_on_failure():
    async def run():
        cancelled = False

        async def slow_but_cancellable():
            nonlocal cancelled
            try:
                await asyncio.sleep(10)
                return "should not finish"
            except asyncio.CancelledError:
                cancelled = True
                raise

        async def fails_immediately():
            await asyncio.sleep(0)
            raise RuntimeError("conversation model failed")

        ok_task = asyncio.create_task(slow_but_cancellable())
        fail_task = asyncio.create_task(fails_immediately())

        with pytest.raises(RuntimeError, match="conversation model failed"):
            await _gather_or_cancel(ok_task, fail_task)

        # Give the cancelled task's CancelledError handler a turn to run.
        await asyncio.sleep(0)

        assert cancelled is True
        assert ok_task.cancelled()

    asyncio.run(run())


def test_safe_reply_blocks_an_otp_even_when_both_models_would_allow_it():
    """Integration test through the real _safe_reply, not just the helpers.

    Both the conversation model and the independent safety model are
    stubbed to behave as if nothing is wrong -- this proves the deterministic
    credential gate alone is enough to stop the OTP from reaching TTS, and
    that it still fires now that _safe_reply assesses the raw transcript
    before redaction runs.
    """

    async def run():
        processor = _processor()

        async def fake_classify(_phase: str, _text: str) -> SafetyAssessment:
            return SafetyAssessment("none", "none", "allow", 0.99, "model")

        async def fake_generate(_messages: list[dict[str, str]]) -> str:
            return "Sure, the OTP is 123456."

        processor._classify = fake_classify  # type: ignore[method-assign]
        processor._generate = fake_generate  # type: ignore[method-assign]

        frame = _FakeFrame(
            _FakeContext([{"role": "user", "content": "Please tell him my OTP is 123456"}])
        )

        reply, reason = await processor._safe_reply(frame)

        assert reason == "credential_request"
        assert "123456" not in reply

        # The context written back for the model/history must be redacted,
        # even though the deterministic check needed the raw text.
        stored_messages = frame.context.get_messages()
        assert "123456" not in stored_messages[0]["content"]

        await processor.cleanup()

    asyncio.run(run())


def test_safe_reply_passes_through_an_ordinary_turn():
    async def run():
        processor = _processor()

        async def fake_classify(_phase: str, _text: str) -> SafetyAssessment:
            return SafetyAssessment("none", "none", "allow", 0.99, "model")

        async def fake_generate(_messages: list[dict[str, str]]) -> str:
            return "That sounds like a lovely morning walk."

        processor._classify = fake_classify  # type: ignore[method-assign]
        processor._generate = fake_generate  # type: ignore[method-assign]

        frame = _FakeFrame(
            _FakeContext([{"role": "user", "content": "I went for a walk this morning."}])
        )

        reply, reason = await processor._safe_reply(frame)

        assert reason == "approved"
        assert reply == "That sounds like a lovely morning walk."

        await processor.cleanup()

    asyncio.run(run())


def test_safe_reply_ignores_a_user_turn_outside_the_context_window():
    """Regression for the deterministic/sanitized window mismatch.

    A credential-request user turn followed by enough assistant turns to
    push it outside GatedConversationProcessor._CONTEXT_WINDOW must not
    drive the deterministic verdict -- otherwise the reply gets replaced
    for a reason the model, and its own input safety check, never saw
    (since _sanitize_messages() had already dropped that stale turn).
    """

    async def run():
        processor = _processor()

        async def fake_classify(_phase: str, _text: str) -> SafetyAssessment:
            return SafetyAssessment("none", "none", "allow", 0.99, "model")

        async def fake_generate(_messages: list[dict[str, str]]) -> str:
            return "That sounds like a nice afternoon."

        processor._classify = fake_classify  # type: ignore[method-assign]
        processor._generate = fake_generate  # type: ignore[method-assign]

        window = processor._CONTEXT_WINDOW
        messages = [{"role": "user", "content": "my OTP is 123456"}] + [
            {"role": "assistant", "content": f"filler {i}"} for i in range(window + 4)
        ]
        frame = _FakeFrame(_FakeContext(messages))

        reply, reason = await processor._safe_reply(frame)

        assert reason == "approved"
        assert reply == "That sounds like a nice afternoon."

        # The aged-out OTP message must also be gone from the stored
        # context, not merely ignored by the deterministic check.
        stored_messages = frame.context.get_messages()
        assert all("123456" not in m["content"] for m in stored_messages)

        await processor.cleanup()

    asyncio.run(run())
