export type SpokenLanguage = "hi-IN" | "en-IN";

// An explicit request always wins, in either script.
// NOTE: `\b` is ASCII-only in JavaScript, so it does NOT match after a
// Devanagari character -- `/english\s*में\b/` silently fails on
// "English में बात करो". Devanagari alternatives are therefore written
// without a trailing boundary.
const WANTS_ENGLISH = [
  /\b(?:speak|talk|say|reply|answer)\b[^.?!]{0,20}\bin english\b/i,
  /\benglish\s*(?:me|mein)\b/i,
  /english\s*में/i,
  /\bin english please\b/i,
  /अंग्रेज़ी में|अंग्रेजी में/u,
];

const WANTS_HINDI = [
  /\b(?:speak|talk|say|reply|answer)\b[^.?!]{0,20}\bin hindi\b/i,
  /\bhindi\s*(?:me|mein)\b/i,
  /hindi\s*में/i,
  /हिंदी में|हिन्दी में/u,
];

const DEVANAGARI = /[ऀ-ॿ]/;

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Which language the person has actually settled into, or `undefined` when
 * this turn carries no useful signal (so the caller keeps the current
 * preference).
 *
 * Deliberately reads the transcript's SCRIPT rather than trusting the STT
 * engine's language guess: a Hindi sentence containing one English loanword
 * ("doctor ne kaha") used to be detected as en-IN, which flipped the spoken
 * reply to English and kept it there. Devanagari anywhere in the turn means
 * they are speaking Hindi, full stop.
 */
export function detectLanguagePreference(transcript: string): SpokenLanguage | undefined {
  const text = transcript.trim();
  if (!text) return undefined;

  // Explicit requests override everything, including the script they used to
  // ask -- "please speak in English" written in Devanagari still means English.
  if (matchesAny(text, WANTS_ENGLISH)) return "en-IN";
  if (matchesAny(text, WANTS_HINDI)) return "hi-IN";

  if (DEVANAGARI.test(text)) return "hi-IN";

  // No Devanagari at all. Only treat this as a real switch to English when
  // there is enough of it to be sure -- short fragments like "hmm", "ok", or
  // "achha" are ambiguous and must not flip a Hindi conversation.
  const words = text.split(/\s+/).filter((word) => /[a-z]/i.test(word));
  return words.length >= 4 ? "en-IN" : undefined;
}
