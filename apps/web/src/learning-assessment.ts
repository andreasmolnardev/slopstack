export type AssessmentQuestion = {
  id: string;
  type: string;
  prompt: string;
  audio_text?: string;
  objective: string;
  points: number;
  choices?: string[];
  items?: string[];
  left_items?: string[];
  right_items?: string[];
};

export type AssessmentAnswers = Record<string, unknown>;

export function initialAssessmentAnswers(questions: AssessmentQuestion[]): AssessmentAnswers {
  return Object.fromEntries(
    questions
      .filter((question) => question.type === 'ordering')
      .map((question) => [question.id, [...(question.items ?? [])]]),
  );
}

export function moveOrderedAnswer(items: string[], from: number, to: number): string[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items;
  }
  const reordered = [...items];
  const [item] = reordered.splice(from, 1);
  reordered.splice(to, 0, item);
  return reordered;
}

export function updateMatchAnswer(
  current: Record<string, string>,
  left: string,
  right: string,
): Record<string, string> {
  return { ...current, [left]: right };
}
