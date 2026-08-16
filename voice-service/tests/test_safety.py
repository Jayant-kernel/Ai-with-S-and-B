from saathi_voice.safety import (
    NORMAL,
    SafetyAssessment,
    choose_reply,
    deterministic_assessment,
    parse_model_assessment,
    redact_pii,
)


def test_redacts_credentials_before_model_use():
    text, kinds = redact_pii("My OTP is 123456 and phone is 9876543210")

    assert "123456" not in text
    assert "9876543210" not in text
    assert kinds == ("otp", "phone")


def test_deterministic_policy_blocks_otp_even_if_model_allows():
    deterministic = deterministic_assessment("Please tell him my OTP is 123456")
    reply, reason = choose_reply("unsafe candidate", deterministic, NORMAL, NORMAL)

    assert reason == "credential_request"
    assert "do not share" in reply.lower()
    assert "unsafe candidate" not in reply


def test_invalid_safety_json_fails_closed():
    broken = parse_model_assessment("not-json")
    reply, reason = choose_reply("candidate", NORMAL, broken, NORMAL)

    assert reason == "safety_unavailable"
    assert reply != "candidate"


def test_output_observer_can_replace_a_candidate():
    unsafe_output = SafetyAssessment(
        "unsafe_advice", "urgent", "block", 0.98, "model"
    )
    reply, reason = choose_reply("take an extra tablet", NORMAL, NORMAL, unsafe_output)

    assert reason == "unsafe_output"
    assert "extra tablet" not in reply


def test_output_clarify_replaces_the_candidate_not_just_block_or_escalate():
    # Regression: only output_model.action in {"block","escalate"} used to
    # be checked, so a "clarify" verdict on the *output* fell all the way
    # through to `return candidate, "approved"`.
    uncertain_output = SafetyAssessment("unsafe_advice", "concern", "clarify", 0.6, "model")
    reply, reason = choose_reply(
        "This unvetted draft must never be spoken.", NORMAL, NORMAL, uncertain_output
    )

    assert reason == "clarify"
    assert "unvetted draft" not in reply


def test_blocked_input_category_is_not_ignored():
    # A category other than credential_request/scam (e.g. privacy) with
    # action="block" must not fall through to the unvetted candidate reply.
    blocked_input = SafetyAssessment("privacy", "concern", "block", 0.9, "model")
    reply, reason = choose_reply("unsafe candidate", NORMAL, blocked_input, NORMAL)

    assert reason == "unsafe_input"
    assert "unsafe candidate" not in reply


def test_scripted_reply_defaults_to_english():
    deterministic = deterministic_assessment("Please tell him my OTP is 123456")
    reply, reason = choose_reply("unsafe candidate", deterministic, NORMAL, NORMAL)

    assert reason == "credential_request"
    assert "do not share" in reply.lower()


def test_scripted_reply_switches_to_hindi_for_hi_in():
    deterministic = deterministic_assessment("Please tell him my OTP is 123456")
    reply, reason = choose_reply(
        "unsafe candidate", deterministic, NORMAL, NORMAL, language="hi-IN"
    )

    assert reason == "credential_request"
    assert "ओटीपी" in reply
    assert "unsafe candidate" not in reply


def test_hindi_scripted_reply_covers_every_reason():
    deterministic = deterministic_assessment("Transfer money by UPI now")
    scam_reply, _ = choose_reply("draft", deterministic, NORMAL, NORMAL, language="hi-IN")
    assert "धोखाधड़ी" in scam_reply

    escalate = SafetyAssessment("self_harm", "urgent", "escalate", 0.95, "model")
    urgent_reply, _ = choose_reply("draft", NORMAL, escalate, NORMAL, language="hi-IN")
    assert "आपातकालीन" in urgent_reply

    broken = parse_model_assessment("not-json")
    unavailable_reply, _ = choose_reply("draft", NORMAL, broken, NORMAL, language="hi-in")
    assert "सुरक्षित जाँच" in unavailable_reply


def test_deterministic_policy_detects_hindi_self_harm():
    for text in ("मैं खुदकुशी करना चाहता हूँ", "मैं आत्महत्या करना चाहता हूँ"):
        assessment = deterministic_assessment(text)
        assert assessment.category == "self_harm"
        assert assessment.action == "escalate"


def test_deterministic_policy_detects_hindi_breathing_emergency():
    assessment = deterministic_assessment("मुझे सांस नहीं आ रही")

    assert assessment.category == "medical"
    assert assessment.action == "escalate"


def test_deterministic_policy_detects_hindi_chest_pain():
    assessment = deterministic_assessment("सीने में तेज दर्द हो रहा है")

    assert assessment.category == "medical"
    assert assessment.action == "escalate"


def test_deterministic_policy_detects_hindi_abuse():
    assessment = deterministic_assessment("मुझे मार रहे हैं")

    assert assessment.category == "abuse"
    assert assessment.action == "escalate"


def test_deterministic_policy_detects_previously_missed_self_harm_phrasings():
    # Regression: safety.py's self-harm pattern used to be a truncated port
    # of safety.ts's, missing "hurt myself", "suicidal", and "going to die".
    for text in (
        "I want to hurt myself tonight",
        "I have been feeling suicidal lately",
        "I am going to die, I cannot take this anymore",
    ):
        assessment = deterministic_assessment(text)
        assert assessment.category == "self_harm", text
        assert assessment.action == "escalate", text


def test_deterministic_policy_detects_previously_missed_medical_phrasings():
    # Regression: safety.py's medical pattern used to miss "unable to
    # breathe", "severe shortness of breath", and chest pain co-occurring
    # with sweating/dizziness (a classic cardiac-emergency combination).
    for text in (
        "I am unable to breathe properly right now",
        "I have severe shortness of breath",
        "I have chest pain and I am sweating a lot",
        "chest pain and feeling dizzy",
    ):
        assessment = deterministic_assessment(text)
        assert assessment.category == "medical", text
        assert assessment.action == "escalate", text


def test_deterministic_policy_detects_fall_and_confusion():
    # Regression: safety.py had no fall/confusion coverage at all -- TS
    # treats these as separate urgent SafetyConcern values; here they fold
    # into the coarser "medical" category (see the comment above
    # _MEDICAL_PATTERNS).
    for text in (
        "I fell and I can't get up, I think I'm bleeding",
        "I can't get up",
        "I am suddenly confused and don't know where I am",
    ):
        assessment = deterministic_assessment(text)
        assert assessment.category == "medical", text
        assert assessment.action == "escalate", text

    for text in ("गिर गया और उठ नहीं पा रहा", "अचानक उलझन में हूँ"):
        assessment = deterministic_assessment(text)
        assert assessment.category == "medical", text
        assert assessment.action == "escalate", text


def test_deterministic_policy_detects_previously_missed_scam_phrasings():
    # Regression: the gift-card/remote-access/screen-share scam pattern
    # (the classic tech-support scam vector targeting elders) was missing.
    for text in (
        "he told me to buy a gift card to pay the fine",
        "the caller wants remote access to my account",
        "they asked for screen share to check my bank account",
    ):
        assessment = deterministic_assessment(text)
        assert assessment.category == "scam", text
        assert assessment.action == "block", text


def test_deterministic_policy_detects_previously_missed_credential_phrasings():
    # Regression: phrasing that avoids the literal words otp/pin/password
    # but still solicits bank/card details was missing.
    for text in (
        "please give me your bank detail so I can help",
        "tell me your card number now",
    ):
        assessment = deterministic_assessment(text)
        assert assessment.category == "credential_request", text
        assert assessment.action == "block", text


def test_deterministic_assessment_is_unaffected_by_prior_redaction():
    # Regression for the bug where _safe_reply ran deterministic_assessment
    # on already-redacted text: "OTP is 123456" -> "[OTP_REDACTED]" no
    # longer contains the word "otp", so the credential gate opened.
    raw = "Please tell him my OTP is 123456"
    redacted, _ = redact_pii(raw)

    assert deterministic_assessment(raw).category == "credential_request"
    assert deterministic_assessment(redacted) is NORMAL
