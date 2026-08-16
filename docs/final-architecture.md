# Saathi final architecture handoff

## Product in one paragraph

Saathi is a phone-first AI companion for older adults in India. It listens
patiently in Hindi, Hinglish, or Indian English, remembers safe and useful facts
with consent, encourages small healthy actions, and supports reminders without
pretending to be a doctor or a family member. Its main difference from a normal
voice bot is not only natural speech: it combines slow-speaker-aware turn taking,
an independent safety system, and a privacy-controlled memory gate.

## Selected stack

| Responsibility | Current choice | Why |
| --- | --- | --- |
| Local UI | Next.js 16 + TypeScript | Fast browser testing and diagnostics |
| Streaming orchestration | Pipecat 1.7 + Python | WebRTC/phone audio frames and interruption support |
| Speech recognition | Sarvam Saaras v3 | India-first multilingual and code-mixed speech |
| Conversation brain | Groq `llama-3.3-70b-versatile` | Available now without an OpenAI key |
| Safety brain | Groq `openai/gpt-oss-safeguard-20b` | Independent risk classification |
| Speech output | Sarvam Bulbul v3 | Natural Indian-language and Hinglish speech |
| Turn taking | Silero VAD + Smart Turn v3 | Separates a pause from a completed thought |
| Persistent data | Encrypted PostgreSQL/Supabase schema | Consent, TTL, audit, and structured reminders |
| Phone transport | Exotel | Indian phone connectivity and normal handsets |

OpenAI can replace the conversation or safety model later through the existing
provider interface. It is not required to proceed.

## Safety order

1. Saaras produces text.
2. Deterministic patterns catch clear OTP, credential, scam, self-harm, and
   emergency phrases immediately.
3. Direct identifiers are redacted before model context or memory processing.
4. The conversation model and input safety model run in parallel.
5. The completed candidate reply is checked by the safety model.
6. A deterministic policy releases or replaces the reply.
7. Only approved text reaches Bulbul TTS.

This is defence in depth, not a guarantee of diagnosis or emergency response.
Actual caregiver or emergency escalation must require consent, verified contact
details, rate limits, and a human-tested operating procedure.

## What is connected today

- Sarvam and Groq credentials load server-side from `.env.local`.
- The browser voice route uses Groq automatically when its key is present.
- Input safety runs in parallel; output safety runs before TTS.
- Both TypeScript and Pipecat paths redact common Indian PII.
- The Pipecat WebRTC runner starts locally.
- Memory gates, read budgets, reminder state logic, and database schema exist.

## What needs external details later

| Integration | Required detail |
| --- | --- |
| Exotel | SID, API key/token, ExoPhone/caller ID, enabled streaming flow |
| Deployment | Public HTTPS/WSS URL mapped to the Pipecat `/ws` endpoint |
| Database | PostgreSQL/Supabase URL, service credential, encryption key |
| Identity | Stable elder ID and verified caregiver relationship |
| Operations | Consent wording, deletion flow, escalation contacts, DLT setup |

Do not paste these secrets into chat or commit them. Add them to local or hosted
secret storage after the corresponding account is ready.

## First measured test

The first user test should measure one thing before adding more features: during
a three-minute Hinglish story with natural pauses, how often does Saathi cut the
speaker off? Record interruption count, end-of-turn latency, safety false
positives, and whether the elder felt heard. That gives the project the measured
number the architecture document currently lacks.
