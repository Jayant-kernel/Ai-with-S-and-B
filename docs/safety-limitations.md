# Safety limitations

Saathi is an AI companion, not a doctor, therapist, relative, or emergency service.

The Sarvam REST path runs a deterministic cue classifier before response generation for falls, severe chest pain, breathing difficulty, acute confusion, self-harm, abuse, being stranded, and medication uncertainty. It changes the dialogue objective but does not diagnose, contact anyone, or replace emergency services. Rule coverage is necessarily incomplete and must be evaluated for Hindi, Hinglish, and English false positives and false negatives.

Realtime speech-to-speech is not a deterministic pre-speech safety gate. Audio can start before an independent text policy has approved every word. Later phases must keep medical, financial, reminder, and escalation actions behind validated server tools and run safety observation in parallel.

The MVP must not diagnose, change medicine instructions, request credentials or payment authorization, impersonate a relative, clone a voice, place calls, or automatically contact family.
