# Saathi

Saathi is an India-first AI voice companion for older adults. Its primary pipeline uses Sarvam for Hindi, Hinglish, Indian English, and other supported Indian languages.

This is a hackathon and user-testing project. It is not a medical device, therapist, emergency service, or replacement for family contact.

## Current status

The Sarvam chained voice path is implemented and has passed a live API smoke test:

```text
Browser recording -> Saaras v3 STT -> Sarvam 105B Conversations -> Bulbul v3 TTS -> browser speaker
```

The permanent key stays on the server. Audio turns are capped at 8 MB/29 seconds, context is bounded and encrypted, and Saathi does not store audio or transcripts in a server database. `/debug` compares Bulbul voices. The earlier OpenAI Realtime implementation remains at `/debug/openai`, but it requires OpenAI API credits.

## Windows PowerShell setup

```powershell
cd "C:\Users\Jayant\Desktop\voice elderly\saathi-elder-companion"
npm install
Copy-Item .env.example .env.local
notepad .env.local
```

Add `SARVAM_API_KEY` to `.env.local`. Add `OPENAI_API_KEY` only if you also want the OpenAI comparison screen. `GEMINI_API_KEY` is available as a server-only slot for the upcoming Gemini Live test adapter; it is not used by the primary route yet. Do not paste keys into chat, prefix them with `NEXT_PUBLIC_`, or commit `.env.local`.

Start the application:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Press **Start conversation** once, allow microphone access, and confirm that the input meter moves. Saathi automatically cycles from listening to replying and back to listening until **End conversation** is pressed. **I'm finished** remains as a manual fallback. The Sarvam diagnostic page is at [http://localhost:3000/debug](http://localhost:3000/debug).

The health check at [http://localhost:3000/api/health](http://localhost:3000/api/health) returns configuration booleans only.

## Checks

```powershell
npm run check
npm run build
npm run test:sarvam-live
```

`npm run check` runs ESLint, TypeScript, and 37 unit tests. `check` and `build` do not spend API credits. `test:sarvam-live` synthesizes a harmless Hindi sample and sends one complete turn through the local Sarvam pipeline, so it requires the dev server and spends a small amount of Sarvam credit.

## Secret handling

- Sarvam, OpenAI, and Gemini permanent API keys are server-only.
- The Sarvam browser path receives reply data and a short-lived encrypted context token, never the key.
- The OpenAI comparison path receives only a short-lived Realtime client credential.
- `.env.local`, database files, recordings, generated reports, and test secrets are ignored by Git.
- Health responses and configuration errors never include key values or prefixes.

## Voice safety limitation

The Sarvam chain now classifies explicit emergency and medication-uncertainty cues before response generation and gives the conversational model a constrained safety objective. This classifier is an additional guard, not diagnosis or guaranteed emergency detection. The parallel model-based safety observer, validated action tools, and caregiver escalation permissions are not implemented yet. The OpenAI Realtime comparison cannot deterministically approve every word before speech begins.

## Cost and context controls

The Sarvam conversation model runs with reasoning disabled for lower voice latency and uses at most sixteen recent messages. Context is encrypted and authenticated by the server, expires after 30 minutes, and is not stored in a database. `/debug` shows STT, conversation, TTS, and total latency for the last turn.

## Optional Codex and Claude Code review

Codex can ask the locally authenticated Claude Code engine for a focused, read-only second review, verify its findings, and remain the sole code writer. See [the collaboration guide](docs/ai-collaboration.md) for the conversational workflow, PowerShell command, and privacy limits.

## Current limitations

The live API chain is confirmed, but a human still needs to judge Hindi/Hinglish warmth, question frequency, microphone quality, Bulbul voice choice, pause behavior, and elder usability. The browser now runs a continuous conversation loop, but each turn still uses REST rather than full-duplex streaming; spoken interruption during Saathi's reply therefore needs the visible **Pause Saathi** control. Current-call context is implemented, while cross-call personal memory, consent controls, reminders, and the parallel safety observer are later phases. Voice cloning, telephone calls, and automatic family escalation remain disabled.
