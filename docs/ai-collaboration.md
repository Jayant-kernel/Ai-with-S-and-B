# Codex and Claude Code collaboration

Codex remains the sole writer for this repository. When a second opinion is useful, Codex can call the authenticated Claude Code Sonnet engine, give it an explicit read-only source bundle, verify its findings, and implement only confirmed changes.

This uses the authenticated Claude Pro account, but it does not type into or scrape the visible Claude Code chat panel.

## From this conversation

Ask Codex:

> Ask Claude Code to audit the Realtime connection lifecycle, then verify its findings and implement only confirmed fixes.

Codex will select a small set of relevant files, run the helper, compare the response against the code and SDK documentation, make any justified edits itself, and run the project checks.

## From PowerShell

```powershell
npm run ai:claude-review -- `
  -Task "Review connection cleanup and identify only reproducible defects." `
  -Files "components/companion/realtime-companion.tsx" `
  -TaskType general `
  -TimeoutSeconds 120
```

For multiple files, call the script directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/ask-claude.ps1 `
  -Task "Review this API boundary for secret leakage." `
  -Files "app/api/realtime/session/route.ts","lib/realtime/client-secret.ts"
```

The helper accepts only explicit repository files. It refuses `.env` files, generated directories, dependency directories, files outside the repository, and files over 200 KB. Claude receives no tools and cannot edit the workspace during the review.

## Model routing

The helper routes work conservatively for a Claude Pro account:

| Task type | Model | Effort | Use for |
| --- | --- | --- | --- |
| `mechanical` | Haiku | Low | Formatting, renames, simple consistency checks |
| `general` | Sonnet | Medium | Feature review, tests, ordinary debugging |
| `security` | Opus, then Sonnet fallback | High | Privacy, safety gates, authentication, secret handling |
| `architecture` | Opus, then Sonnet fallback | High | Cross-module design and lifecycle review |

Pass `-Model` or `-Effort` only when a specific review needs an override. Opus is reserved for high-risk reasoning and automatically falls back to Sonnet high effort when the subscription or current quota does not expose it. Sonnet remains the default implementation and everyday review model.

## Operating rules

- Use one writer at a time. Codex owns edits; Claude supplies review findings.
- Keep each review focused so findings can be verified against actual code and documentation.
- Never send environment files, API keys, raw private transcripts, recordings, or elder profile data.
- Treat both agents' output as proposals until tests or source evidence confirm it.
- Keep the Hindi/Hinglish microphone and voice-quality check as a human gate.
- Do not commit, push, deploy, migrate data, or enable external messaging without explicit approval.
