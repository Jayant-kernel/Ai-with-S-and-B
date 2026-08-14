# Architecture

## Primary Sarvam implementation

Saathi is one full-stack Next.js TypeScript application. Server configuration is parsed through a typed Zod schema. The health route publishes only boolean readiness information.

The primary path is:

```text
Browser MediaRecorder -> /api/sarvam/turn -> Saaras v3
  -> sarvam-105b-conversations -> Bulbul v3 -> browser speaker
```

The permanent Sarvam key remains on the server. The same-origin, POST-only, locally rate-limited route accepts a completed audio turn, validates its type and size, and calls all three Sarvam services server-side. The browser receives transcript, reply, WAV audio, timings, and an encrypted authenticated conversation-state token. No audio or transcript is stored in a server database.

Conversation state is limited to recent exact messages and policy counters, expires after 30 minutes, and is encrypted so the browser cannot read or fabricate its contents. The encrypted token is held in browser session storage so a refresh does not erase the current call; ending the conversation clears it. Expired legacy state degrades to a fresh conversation instead of killing the voice turn.

After STT, the route uses explicit orchestration layers before calling the conversational model:

```text
Transcript
  -> deterministic safety classification
  -> per-turn dialogue policy and response objective
  -> bounded exact session context
  -> Sarvam conversation model
  -> speech-first response shaping (short output, at most one question)
  -> Bulbul TTS
```

The policy distinguishes emotional exploration, quiet companionship, repair, medication uncertainty, and urgent safety checking. It also supplies India-local time context, suppresses repeated suggestions, and limits consecutive question turns. Model-generated summaries are not stored as facts, which prevents an invented inference from becoming memory.

Ending the conversation aborts active network work, stops microphone tracks and playback, revokes object URLs, and clears browser-held context.

## OpenAI comparison

The earlier browser WebRTC path remains isolated at `/debug/openai`. Its permanent OpenAI key stays server-side, while `/api/realtime/session` mints a temporary client credential. It uses `gpt-realtime-2.1-mini` by default, with the quality model and `marin`/`cedar` available for comparison when OpenAI API credits exist.

## Deliberately deferred

Cross-call personal memory requires identity, consent, correction/deletion controls, provenance, and encrypted persistent storage. It is not approximated with unverified model-generated facts. Full spoken barge-in, streaming STT/LLM/TTS, and semantic interruption detection require a persistent duplex transport such as WebRTC and are not claimed by the current REST implementation.
