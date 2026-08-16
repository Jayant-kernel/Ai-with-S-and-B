import pytest

from saathi_voice.config import VoiceConfig


def test_requires_only_server_side_keys(monkeypatch):
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    with pytest.raises(ValueError, match="SARVAM_API_KEY, GROQ_API_KEY"):
        VoiceConfig.from_env()


def test_exotel_is_disabled_by_default(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-test")
    monkeypatch.setenv("GROQ_API_KEY", "groq-test")
    monkeypatch.delenv("ENABLE_EXOTEL", raising=False)

    config = VoiceConfig.from_env()

    assert config.enable_exotel is False
    assert config.enable_model_safety is True
