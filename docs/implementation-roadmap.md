# Saathi implementation roadmap

## Completed in this release

- Next.js browser voice loop with server-only provider keys.
- Sarvam Saaras v3 speech recognition and Bulbul v3 speech output.
- Groq conversation brain with Sarvam/OpenAI provider fallbacks.
- Independent Groq safety brain for input and output classification.
- Parallel input safety and reply generation to reduce added latency.
- Deterministic final release policy that fails closed on safety errors.
- PII redaction before external model calls, session context, and memory gates.
- Encrypted, expiring browser conversation state with bounded history.
- Pipecat 1.7 streaming service with Silero VAD and Smart Turn v3.
- Local WebRTC and disabled-by-default Exotel transport configuration.
- Post-turn memory classification, private-mode fencing, and read budgets.
- Encrypted PostgreSQL/Supabase schema for memory, reminders, and audits.
- Reminder drafts with read-back and explicit-confirmation state transitions.
- Task-aware, secret-safe Claude Code review workflow using Claude Pro.

## Verified without paid live calls

- TypeScript lint, type checking, and unit tests.
- Python unit tests and Ruff linting.
- Next.js production build.
- Pipecat runner imports and command-line startup.
- Live Groq conversation and safeguard model access.

## Verification performed with provider credits

- One end-to-end browser turn must pass through Sarvam TTS, Saaras STT, Groq
  conversation, both safety checks, Bulbul TTS, and encrypted context return.
- Record latency for STT, conversation, safety, TTS, and the complete turn.

## Requires external configuration

### Exotel phone calls

Required before activation: an Exotel account with bidirectional Voicebot or
streaming access, ExoPhone/caller ID, account SID, API key/token, App Bazaar
flow, public WSS deployment URL, outbound consent, and applicable DLT setup.

### Durable cross-call memory

Required before activation: PostgreSQL/Supabase credentials, a dedicated
encryption key, stable elder identity, consent state, correction/deletion UI,
and retention policy. Until then, `ENABLE_MEMORY` remains false.

### Reminders and escalation

Required before activation: elder timezone, verified caregiver contacts,
permission scopes, scheduler deployment, retry limits, and an escalation
operating procedure. The model never sends messages or changes reminders
without deterministic validation and confirmation.

## Deterministic pattern observations for elder testing

These are known characteristics of the current deterministic safety
patterns (shared between `lib/companion/safety.ts` and the Pipecat
service's `deterministic_assessment`). They fail toward caution, not away
from it, so they are not release blockers -- but they should be measured
during the five-elder test rather than tuned blind beforehand.

- The Hindi abuse pattern `बंद कर दिया` ("shut/locked ...") also matches
  ordinary sentences such as "मैंने दरवाजा बंद कर दिया" ("I closed the
  door"), which would trigger an abuse/escalate response. Watch for this
  specific false positive during testing.
- Credential and scam patterns (OTP, PIN, UPI, bank transfer) are
  English-only on both paths. This matches how these loanwords are
  actually spoken inside Hindi/Hinglish sentences, but a purely
  Devanagari-transliterated "ओटीपी" is not caught deterministically today.

Do not expand or narrow these patterns before the first elder test --
record what participants actually say and trigger on instead.

## Next execution order

1. Test three-minute Hinglish conversations with five older adults.
2. Measure interruption count, end-of-turn latency, false safety triggers, and
   whether each participant felt heard.
3. Tune Smart Turn and Silero using measured pauses rather than assumptions.
4. Connect the encrypted database and consent/deletion controls.
5. Deploy the Pipecat WSS service and connect one Exotel test number.
6. Add confirmed reminders, then consented caregiver escalation.
7. Evaluate voice cloning only after consent, impersonation safeguards, and
   ordinary companion quality are validated.
