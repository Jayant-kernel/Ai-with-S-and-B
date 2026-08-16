from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

RiskCategory = Literal[
    "none",
    "medical",
    "self_harm",
    "abuse",
    "scam",
    "credential_request",
    "privacy",
    "unsafe_advice",
]
SafetyAction = Literal["allow", "clarify", "block", "escalate"]


@dataclass(frozen=True)
class SafetyAssessment:
    category: RiskCategory
    severity: Literal["none", "concern", "urgent"]
    action: SafetyAction
    confidence: float
    source: Literal["model", "deterministic", "disabled", "model_error"]


NORMAL = SafetyAssessment("none", "none", "allow", 1.0, "deterministic")

_PII_PATTERNS = (
    ("AADHAAR", re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    (
        "OTP",
        re.compile(r"\b(?:otp|one[ -]?time password|code)\D{0,12}\d{4,8}\b", re.IGNORECASE),
    ),
    ("PHONE", re.compile(r"(?:\+91[ -]?)?[6-9]\d{9}\b")),
    ("UPI", re.compile(r"\b[a-z0-9._-]{2,}@[a-z][a-z0-9.-]{1,}\b", re.IGNORECASE)),
)


def redact_pii(text: str) -> tuple[str, tuple[str, ...]]:
    redacted = text
    kinds: list[str] = []
    for kind, pattern in _PII_PATTERNS:
        redacted, count = pattern.subn(f"[{kind}_REDACTED]", redacted)
        kinds.extend([kind.lower()] * count)
    return redacted, tuple(kinds)


# English patterns intentionally have no Devanagari counterpart here: they
# match code-mixed speech (an elder saying "OTP" or "UPI" inside a Hindi
# sentence, which is how these loanwords are actually spoken in India), and
# lib/companion/safety.ts does not have Hindi-script credential/scam patterns
# either, so this stays at parity with the TypeScript source of truth.
_CREDENTIAL_PATTERN = re.compile(r"\b(?:otp|pin|password|cvv|one[ -]?time password)\b")
_SCAM_PATTERN = re.compile(r"\b(?:send|transfer|pay)\b.{0,30}\b(?:money|rupees|upi|bank)\b")

# Devanagari variants below are ported from the `rules` table in
# lib/companion/safety.ts (self_harm, breathing, chest_pain -> medical here
# since this module's category set has no separate breathing/chest_pain, and
# abuse) so a Hindi-speaking elder gets the same deterministic coverage on
# both the browser and Pipecat paths.
_SELF_HARM_PATTERN = re.compile(
    r"\b(?:kill myself|suicide|want to die|marna chahta|marna chahti)\b"
    r"|खुदकुशी|आत्महत्या|मरना चाहता|मरना चाहती"
)
_MEDICAL_PATTERN = re.compile(
    r"\b(?:can'?t breathe|cannot breathe|severe chest pain)\b"
    r"|सांस नहीं|साँस नहीं|सांस लेने में बहुत|सीने में तेज दर्द|छाती में तेज दर्द"
)
_ABUSE_PATTERN = re.compile(
    r"\b(?:he|she|they|someone|caregiver|son|daughter)\s+(?:hit|hurt|threaten(?:ed|s)?) me\b"
    r"|\blocked me (?:in|out)\b|\bnot safe at home\b"
    r"|मुझे मार|घर में सुरक्षित नहीं|बंद कर दिया"
)


def deterministic_assessment(text: str) -> SafetyAssessment:
    lowered = text.lower()
    if _CREDENTIAL_PATTERN.search(lowered):
        return SafetyAssessment("credential_request", "urgent", "block", 0.99, "deterministic")
    if _SCAM_PATTERN.search(lowered):
        return SafetyAssessment("scam", "urgent", "block", 0.9, "deterministic")
    if _SELF_HARM_PATTERN.search(lowered):
        return SafetyAssessment("self_harm", "urgent", "escalate", 0.98, "deterministic")
    if _MEDICAL_PATTERN.search(lowered):
        return SafetyAssessment("medical", "urgent", "escalate", 0.95, "deterministic")
    if _ABUSE_PATTERN.search(lowered):
        return SafetyAssessment("abuse", "urgent", "escalate", 0.9, "deterministic")
    return NORMAL


def parse_model_assessment(raw: str) -> SafetyAssessment:
    try:
        data = json.loads(raw)
        category = data["category"]
        severity = data["severity"]
        action = data["action"]
        confidence = float(data["confidence"])
        if category not in {
            "none",
            "medical",
            "self_harm",
            "abuse",
            "scam",
            "credential_request",
            "privacy",
            "unsafe_advice",
        }:
            raise ValueError("invalid category")
        if severity not in {"none", "concern", "urgent"}:
            raise ValueError("invalid severity")
        if action not in {"allow", "clarify", "block", "escalate"}:
            raise ValueError("invalid action")
        if not 0 <= confidence <= 1:
            raise ValueError("invalid confidence")
        return SafetyAssessment(category, severity, action, confidence, "model")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return SafetyAssessment("none", "concern", "clarify", 0.0, "model_error")


_ENGLISH_REPLIES: dict[str, str] = {
    "credential_request": (
        "Please do not share any OTP, PIN, password, card number, or bank detail. "
        "I cannot help transfer money or verify a financial request."
    ),
    "scam": (
        "This may be a scam. Please do not send money or share banking details. "
        "Contact your bank or a trusted person using a number you already know."
    ),
    "urgent": (
        "This may need immediate human help. Please contact someone nearby or your "
        "local emergency service now. I can stay with you while you do that."
    ),
    "safety_unavailable": (
        "I am having trouble checking my response safely. Let us pause for a moment "
        "and try again."
    ),
    "unsafe_output": (
        "I do not want to guess or give you unsafe information. Please check with a "
        "trusted person or qualified professional."
    ),
    "clarify": (
        "I may not have understood that safely. Could you say it once more without "
        "sharing any private number or password?"
    ),
}

_HINDI_REPLIES: dict[str, str] = {
    "credential_request": (
        "कृपया कोई ओटीपी, पिन, पासवर्ड, कार्ड नंबर या बैंक की जानकारी साझा न करें। "
        "मैं पैसे भेजने या किसी वित्तीय अनुरोध की पुष्टि करने में मदद नहीं कर सकता।"
    ),
    "scam": (
        "यह धोखाधड़ी हो सकती है। कृपया पैसे न भेजें और बैंक की जानकारी साझा न करें। "
        "अपने बैंक या किसी भरोसेमंद व्यक्ति से उस नंबर पर संपर्क करें जिसे आप पहले से जानते हैं।"
    ),
    "urgent": (
        "इस स्थिति में तुरंत किसी इंसान की मदद की जरूरत हो सकती है। अभी पास के किसी व्यक्ति "
        "या स्थानीय आपातकालीन सेवा से संपर्क करें। जब तक आप ऐसा करते हैं, मैं आपके साथ हूँ।"
    ),
    "safety_unavailable": (
        "अभी मैं इस बात की सुरक्षित जाँच नहीं कर पा रहा हूँ। कृपया थोड़ी देर में फिर कोशिश करें, "
        "और यदि स्थिति जरूरी है तो किसी भरोसेमंद व्यक्ति से तुरंत संपर्क करें।"
    ),
    "unsafe_output": (
        "मैं अनुमान लगाकर असुरक्षित जानकारी नहीं देना चाहता। कृपया किसी भरोसेमंद व्यक्ति या "
        "योग्य विशेषज्ञ से पुष्टि करें।"
    ),
    "clarify": (
        "शायद मैं आपकी बात सुरक्षित तरीके से नहीं समझ पाया। कृपया कोई निजी नंबर या पासवर्ड "
        "बताए बिना एक बार फिर कहें।"
    ),
}


def _scripted_replies(language: str | None) -> dict[str, str]:
    if language and language.lower().startswith("hi"):
        return _HINDI_REPLIES
    return _ENGLISH_REPLIES


def choose_reply(
    candidate: str,
    deterministic: SafetyAssessment,
    input_model: SafetyAssessment,
    output_model: SafetyAssessment,
    language: str | None = None,
) -> tuple[str, str]:
    replies = _scripted_replies(language)
    combined = (deterministic, input_model)
    if any(item.category == "credential_request" for item in combined):
        return replies["credential_request"], "credential_request"
    if any(item.category == "scam" for item in combined):
        return replies["scam"], "scam"
    if any(item.action == "escalate" for item in combined):
        return replies["urgent"], "urgent"
    if input_model.source == "model_error" or output_model.source == "model_error":
        return replies["safety_unavailable"], "safety_unavailable"
    if input_model.action == "block":
        # Any other blocked input category (privacy, abuse, unsafe_advice, ...)
        # must not fall through to the unvetted candidate reply.
        return replies["unsafe_output"], "unsafe_input"
    if output_model.action in {"block", "escalate"}:
        return replies["unsafe_output"], "unsafe_output"
    if input_model.action == "clarify":
        return replies["clarify"], "clarify"
    return candidate, "approved"
