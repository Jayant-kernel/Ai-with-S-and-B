# Architecture

Saathi uses a cascaded speech pipeline because it gives us a text checkpoint
before any reply is spoken. That checkpoint is where privacy redaction, safety,
memory policy, and reminder validation can be enforced.

## Runtime flow

```text
Elder's microphone or phone
  -> WebRTC / Exotel transport
  -> Pipecat orchestration
  -> Silero voice activity detection
  -> Smart Turn v3 endpoint decision
  -> Sarvam Saaras v3 speech-to-text
  -> PII redaction
  -> [conversation brain || input safety brain]
  -> output safety brain
  -> deterministic policy decision
  -> Sarvam Bulbul v3 text-to-speech
  -> elder hears the approved reply
```

Silero answers "is there speech right now?" Smart Turn answers "has the person
finished the thought?" Keeping those as separate decisions is especially useful
for older speakers who pause mid-sentence.

## Why two brains

The conversation brain is optimized for warmth, continuity, language matching,
and natural short replies. The safety brain has one narrow job: classify risk.
It does not converse or provide advice.

Using one model for both jobs creates a conflict. A companion may be strongly
prompted to stay agreeable, while a safety system sometimes needs to stop,
clarify, or escalate. Independent calls also let the input safety check run in
parallel, so most of its latency is hidden behind reply generation.

Neither model gets final authority. A deterministic policy engine receives the
classifications and either releases the draft or substitutes fixed safe speech.
If the safety service times out, returns invalid JSON, or fails, the draft is
not spoken.

## Memory path

```text
Completed turn
  -> redact direct identifiers
  -> post-turn memory gate
  -> discard private/high-risk content
  -> quarantine uncertain content
  -> store approved low-risk facts as encrypted records
```

At the next conversation, only confirmed, approved, unexpired facts can be
loaded, and only within a fixed read budget. Private mode loads no durable
memory and permits no writes. Raw audio is not a memory record.

The policy modules and encrypted PostgreSQL schema are implemented. Persistent
memory is disabled until an elder identity, consent state, encryption key, and
database connection are configured.

## Reminder path

A reminder is structured data, not free-form model text. The model may propose
a reminder, but code parses its time and message, reads it back, and stores it
only after explicit confirmation. Editing creates a new draft that must be read
back again.

## Current transports

The Next.js REST route is the stable browser test path. The Python Pipecat
service is the streaming target and already supports local WebRTC. Exotel
transport code is included but remains disabled until its WSS endpoint and
account flow are configured.

The older OpenAI Realtime comparison remains isolated at `/debug/openai` and is
optional. It is not part of the current Groq + Sarvam build.
