# Saathi

Saathi is an India-first voice companion for older adults. It listens in Hindi,
Hinglish, and Indian English, responds in a warm spoken style, protects private
information, and is designed to remember only facts that are safe and useful.

This is a hackathon and user-testing project. It is not a medical device,
therapist, emergency service, or replacement for family contact.

## What works now

The browser path is ready for immediate testing with the configured Sarvam and
Groq keys:

```text
Microphone -> Saaras v3 STT -> PII redaction
  -> Groq conversation brain + independent Groq safety brain
  -> deterministic policy gate -> Bulbul v3 TTS -> speaker
```

The independent input safety check runs at the same time as reply generation.
The completed reply receives a second safety check, and only the deterministic
policy gate can release text to TTS. Provider or parsing errors fail closed.

A separate Python service in `voice-service/` implements the streaming target:

```text
WebRTC or Exotel -> Pipecat 1.7 -> Silero VAD + Smart Turn v3
  -> Saaras v3 streaming STT -> gated Groq brains
  -> Bulbul v3 streaming TTS
```

Exotel is present but disabled until its account, phone flow, and public WSS URL
are supplied. OpenAI is optional and is not required for the current build.

## Browser setup

```powershell
cd "C:\Users\Jayant\Desktop\voice elderly\saathi-elder-companion"
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

Required values:

```dotenv
SARVAM_API_KEY=your_sarvam_key
GROQ_API_KEY=your_groq_key
CONVERSATION_PROVIDER=auto
SAFETY_PROVIDER=auto
ENABLE_SAFETY_MONITOR=true
```

Open [http://localhost:3000](http://localhost:3000), allow microphone access,
and press **Start conversation**. The permanent keys stay server-side. The
health endpoint returns readiness booleans only and never returns key values.

## Streaming service

```powershell
cd voice-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
python -m saathi_voice.bot -t webrtc
```

The service reads the root `.env.local`, so the two existing keys do not need
to be duplicated. See [voice-service/README.md](voice-service/README.md) for
Exotel activation details.

## Memory and privacy

The current browser call uses a short-lived encrypted context token. Exact
transcripts and audio are not stored in a server database. The repository now
also contains:

- PII redaction for Aadhaar, cards, OTPs, phone numbers, and UPI IDs.
- A post-turn memory gate with `store`, `pending`, and `discard` decisions.
- A strict memory read budget and private-mode read/write fencing.
- An encrypted PostgreSQL/Supabase schema in `database/001_saathi_memory.sql`.
- Deterministic reminder drafts that require spoken read-back and confirmation.

Persistent cross-call memory remains disabled until database credentials,
elder identity, and consent controls are connected. This is intentional: the
system must not quietly treat an unverified model inference as a personal fact.

## Verification

```powershell
npm run check
npm run build
cd voice-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
```

For the complete design and remaining provider setup, read
[the final architecture](docs/final-architecture.md) and
[implementation roadmap](docs/implementation-roadmap.md).
