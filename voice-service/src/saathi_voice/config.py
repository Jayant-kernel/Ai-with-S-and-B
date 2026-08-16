from __future__ import annotations

import os
from dataclasses import dataclass


def _boolean(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    if value.lower() not in {"true", "false"}:
        raise ValueError(f"{name} must be true or false")
    return value.lower() == "true"


@dataclass(frozen=True)
class VoiceConfig:
    sarvam_api_key: str
    groq_api_key: str
    conversation_model: str
    safety_model: str
    stt_model: str
    stt_mode: str
    tts_model: str
    tts_voice: str
    tts_language: str
    tts_pace: float
    enable_exotel: bool
    enable_model_safety: bool
    model_timeout_seconds: float
    safety_timeout_seconds: float

    @classmethod
    def from_env(cls) -> VoiceConfig:
        sarvam_api_key = os.getenv("SARVAM_API_KEY", "").strip()
        groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
        missing = [
            name
            for name, value in {
                "SARVAM_API_KEY": sarvam_api_key,
                "GROQ_API_KEY": groq_api_key,
            }.items()
            if not value
        ]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")

        pace = float(os.getenv("SARVAM_TTS_PACE", "0.85"))
        if not 0.5 <= pace <= 2.0:
            raise ValueError("SARVAM_TTS_PACE must be between 0.5 and 2.0")

        return cls(
            sarvam_api_key=sarvam_api_key,
            groq_api_key=groq_api_key,
            conversation_model=os.getenv(
                "CONVERSATION_MODEL", "llama-3.3-70b-versatile"
            ),
            safety_model=os.getenv(
                "SAFETY_MODEL", "openai/gpt-oss-safeguard-20b"
            ),
            stt_model=os.getenv("SARVAM_STT_MODEL", "saaras:v3"),
            stt_mode=os.getenv("SARVAM_STT_MODE", "codemix"),
            tts_model=os.getenv("SARVAM_TTS_MODEL", "bulbul:v3"),
            tts_voice=os.getenv("SARVAM_TTS_VOICE", "ritu"),
            tts_language=os.getenv("SARVAM_TTS_LANGUAGE", "hi-IN"),
            tts_pace=pace,
            enable_exotel=_boolean("ENABLE_EXOTEL"),
            enable_model_safety=_boolean("ENABLE_MODEL_SAFETY", True),
            model_timeout_seconds=float(os.getenv("MODEL_TIMEOUT_SECONDS", "20")),
            safety_timeout_seconds=float(os.getenv("SAFETY_TIMEOUT_SECONDS", "5")),
        )
