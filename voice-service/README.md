# Saathi real-time voice service

This service implements the streaming and phone-ready architecture:

```text
Browser WebRTC or Exotel
  -> Pipecat 1.7
  -> Silero VAD + Local Smart Turn v3
  -> Sarvam Saaras v3 streaming STT
  -> PII redaction
  -> Groq conversation and independent safety models
  -> deterministic release policy
  -> Sarvam Bulbul v3 streaming TTS
```

The conversation model drafts the natural reply. A separate safety model checks
the user's input in parallel and checks the completed draft before speech. The
draft is held inside `GatedConversationProcessor`; it cannot reach TTS until the
deterministic policy approves or replaces it. Safety failures therefore fail
closed.

## Local WebRTC test

The service automatically loads `../.env.local`, followed by this directory's
optional `.env` file.

```powershell
cd voice-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
python -m saathi_voice.bot -t webrtc
```

Required keys:

```dotenv
SARVAM_API_KEY=...
GROQ_API_KEY=...
ENABLE_MODEL_SAFETY=true
```

Default models are `saaras:v3`, `llama-3.3-70b-versatile`,
`openai/gpt-oss-safeguard-20b`, and `bulbul:v3`.

## Exotel activation later

No Exotel secret is needed to write or test the WebRTC code. For a real phone
call, collect these items from the Exotel account:

1. Voice/Voicebot or bidirectional streaming access.
2. An ExoPhone or approved outbound caller ID.
3. Account SID, API key, and API token for originating or managing calls.
4. The Exotel App Bazaar flow or Voicebot applet connected to the bot stream.
5. A deployed public `wss://.../ws` endpoint for this service.
6. Outbound-call consent and any required Indian DLT configuration.

After those are ready, set `ENABLE_EXOTEL=true` and run:

```powershell
python -m saathi_voice.bot -t exotel --host 0.0.0.0 --port 7860
```

Pipecat recognizes the Exotel WebSocket handshake and uses its Exotel frame
serializer. Keep `ENABLE_MODEL_SAFETY=true`; the service refuses to enable
Exotel without it.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m saathi_voice.bot --help
```
