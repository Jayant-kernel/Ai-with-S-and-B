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
_CREDENTIAL_PATTERNS = (
    re.compile(r"\b(?:otp|pin|password|cvv|one[ -]?time password)\b"),
    re.compile(r"\b(?:share|tell|send|give)\b.{0,30}\b(?:bank detail|card number|upi pin)\b"),
)
_SCAM_PATTERNS = (
    re.compile(r"\b(?:send|transfer|pay)\b.{0,30}\b(?:money|rupees|upi|bank)\b"),
    re.compile(r"\b(?:gift card|remote access|screen share)\b.{0,30}\b(?:pay|bank|account)\b"),
)

# Each tuple below is ported pattern-for-pattern from the `rules` table in
# lib/companion/safety.ts -- that file is the source of truth for this
# deterministic layer. lib/companion/safety.ts's `SafetyConcern` type has
# separate fall/confusion/breathing/chest_pain values; this module's
# RiskCategory only has the coarser "medical" (matching the *model-based*
# safety schema in both languages, which also has no finer categories), so
# all of those fold into _MEDICAL_PATTERNS here. Devanagari variants are
# ported the same way, for self_harm/medical/abuse (credential/scam stay
# Latin-script-only in both languages -- see the comment above).
_SELF_HARM_PATTERNS = (
    re.compile(r"\b(?:kill|hurt) myself\b"),
    re.compile(r"\bsuicid(?:e|al)\b"),
    re.compile(r"\b(?:want|going) to die\b"),
    re.compile(r"\bmarna chaht[ai]\b"),
    re.compile(r"खुदकुशी|आत्महत्या|मरना चाहता|मरना चाहती"),
)
_MEDICAL_PATTERNS = (
    # breathing
    re.compile(r"\b(?:cannot|can'?t|unable to) breathe\b"),
    re.compile(r"\bsevere (?:shortness of breath|breathing difficulty)\b"),
    re.compile(r"सांस नहीं|साँस नहीं|सांस लेने में बहुत"),
    # chest pain
    re.compile(r"\bsevere chest pain\b"),
    re.compile(r"\bchest pain\b.*\b(?:sweat|dizzy|breath|crush)"),
    re.compile(r"सीने में तेज दर्द|छाती में तेज दर्द"),
    # fall (urgent tier only -- TS's separate concern-tier fall/chest-pain/
    # stranded rules are out of scope here, see docs/implementation-roadmap.md)
    re.compile(r"\b(?:fell|fallen|had a fall)\b.*\b(?:can'?t|cannot|unable|bleeding|head|injur)"),
    re.compile(r"\bcan'?t (?:stand up|get up)\b"),
    re.compile(r"गिर[^।.!?]{0,60}(?:उठ नहीं|चोट)"),
    # confusion
    re.compile(r"\b(?:suddenly confused|don'?t know where i am|cannot remember where i am)\b"),
    re.compile(r"पता नहीं मैं कहाँ|अचानक उलझन"),
)
_ABUSE_PATTERN = re.compile(
    r"\b(?:he|she|they|someone|caregiver|son|daughter)\s+(?:hit|hurt|threaten(?:ed|s)?) me\b"
    r"|\blocked me (?:in|out)\b|\bnot safe at home\b"
    r"|मुझे मार|घर में सुरक्षित नहीं|बंद कर दिया"
)


def deterministic_assessment(text: str) -> SafetyAssessment:
    lowered = text.lower()
    if any(pattern.search(lowered) for pattern in _CREDENTIAL_PATTERNS):
        return SafetyAssessment("credential_request", "urgent", "block", 0.99, "deterministic")
    if any(pattern.search(lowered) for pattern in _SCAM_PATTERNS):
        return SafetyAssessment("scam", "urgent", "block", 0.9, "deterministic")
    if any(pattern.search(lowered) for pattern in _SELF_HARM_PATTERNS):
        return SafetyAssessment("self_harm", "urgent", "escalate", 0.98, "deterministic")
    if any(pattern.search(lowered) for pattern in _MEDICAL_PATTERNS):
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
    if output_model.action != "allow":
        # The candidate reaches TTS only when output safety explicitly says
        # "allow". Checking only for block/escalate let a "clarify" verdict
        # on the *output* fall through to the unvetted candidate below --
        # the one case this whole gate exists to prevent.
        if output_model.action == "clarify":
            return replies["clarify"], "clarify"
        return replies["unsafe_output"], "unsafe_output"
    if input_model.action == "clarify":
        return replies["clarify"], "clarify"
    return candidate, "approved"
