function sentenceParts(text: string) {
  const normalized = text
    .replace(/^[-*•]\s*/gmu, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/gu)?.map((part) => part.trim()) ?? [];
}

function trimAtWord(text: string, maxCharacters: number) {
  if (text.length <= maxCharacters) return text;
  const candidate = text.slice(0, maxCharacters + 1);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary > maxCharacters * 0.6 ? boundary : maxCharacters).trim()}…`;
}

export function shapeSpokenResponse(
  raw: string,
  options: { maxSentences?: number; maxQuestions?: number; maxCharacters?: number } = {},
) {
  const maxSentences = options.maxSentences ?? 3;
  const maxQuestions = options.maxQuestions ?? 1;
  const maxCharacters = options.maxCharacters ?? 520;
  let questions = 0;
  const selected: string[] = [];

  for (const sentence of sentenceParts(raw)) {
    if (selected.length >= maxSentences) break;
    const isQuestion = sentence.includes("?") || sentence.includes("？");
    if (isQuestion && questions >= maxQuestions) continue;
    if (isQuestion) questions += 1;
    selected.push(sentence);
  }

  const fallback = maxQuestions === 0 ? "Hmm…" : raw.trim();
  const spoken = trimAtWord(selected.join(" ") || fallback, maxCharacters);
  return {
    spoken,
    trimmed: spoken !== raw.trim(),
    questionCount: questions,
  };
}
