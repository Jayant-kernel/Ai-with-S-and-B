# Local testing

Run all no-credit checks in Windows PowerShell:

```powershell
npm run check
npm run build
```

Start the app with `npm run dev`, then open `http://localhost:3000`.

Automated checks confirm:

- `/api/health` contains booleans and no credentials;
- `.env.local` does not appear in `git status`;
- lint, typecheck, tests, and build pass without external API calls.
- the Sarvam route rejects oversized/unsupported audio and never exposes a permanent key;
- conversation context is bounded, signed, and expires after 30 minutes;
- the OpenAI session route returns only a temporary credential;
- the standard key is absent from rendered HTML and static browser bundles.

For the first live test:

1. Open `http://localhost:3000/debug` in Chrome or Edge. If you use VS Code's integrated browser, open **Site Permissions** from its toolbar and allow the microphone first.
2. Use headphones and press **Start conversation** once.
3. Allow microphone access.
4. Speak one Hindi or Hinglish turn and confirm the input meter moves. Wait for automatic submission after a short pause, or press **I'm finished** manually.
5. Press **Pause Saathi** while it is speaking and confirm output stops promptly.
6. Confirm Saathi returns to listening automatically, then speak a second turn and confirm the reply remembers the previous turn.
7. Press **End conversation** and confirm the microphone indicator disappears and transcript cards clear.
8. Switch between the Bulbul voices and repeat the same prompt.

For a repeatable live backend check while the dev server is running:

```powershell
npm run test:sarvam-live
```

The OpenAI Realtime comparison remains at `http://localhost:3000/debug/openai` and requires separate OpenAI API credits.

The Sarvam debug timings are measured by the server and are not a billing statement.
