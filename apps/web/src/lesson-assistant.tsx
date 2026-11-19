import { useState } from 'react';
import { askLessonAssistant } from './api/generated/sdk.gen';
import { client as generatedClient } from './api/generated/client.gen';

type HelpAction = 'explain' | 'example' | 'mistake' | 'hint' | 'practice';
type AssistantReply = { response: string; action: HelpAction; scene_index: number };

const actions: { value: HelpAction; label: string }[] = [
  { value: 'explain', label: 'Explain this scene' },
  { value: 'example', label: 'Give another example' },
  { value: 'mistake', label: 'Explain my mistake' },
  { value: 'hint', label: 'Give me a hint' },
  { value: 'practice', label: 'Make a practice question' },
];

export function LessonAssistant({ courseId, sceneIndex, disabled = false }: { courseId: string; sceneIndex: number; disabled?: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(action: HelpAction) {
    setBusy(true);
    setError('');
    setReply('');
    try {
      const result = await askLessonAssistant({ client: generatedClient, path: { id: courseId }, body: { scene_index: sceneIndex, action, question: question.trim(), answer: answer.trim() } });
      if (result.error || !result.data) throw new Error('Could not get lesson help.');
      const response = (result.data as AssistantReply).response;
      if (typeof response !== 'string' || !response.trim()) throw new Error('The tutor returned an empty response.');
      setReply(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not get lesson help.');
    } finally {
      setBusy(false);
    }
  }

  return <aside aria-labelledby="lesson-assistant-title" className="mt-6 rounded-xl border border-[#aa65c9]/35 bg-[#0e0621] p-4">
    <h2 id="lesson-assistant-title" className="font-semibold">Ask about this lesson</h2>
    <p className="mt-1 text-sm text-[#b7adcc]">The tutor uses this scene and its linked concepts. Your question and answer are sent to the configured AI provider. It will not edit your course.{disabled ? ' Connect to the internet to use lesson help.' : ''}</p>
    <label className="mt-3 block text-sm" htmlFor="lesson-assistant-question">What would you like help with?</label>
    <textarea id="lesson-assistant-question" maxLength={1200} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask a question about this scene" className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-[#211638] p-3" />
    <label className="mt-3 block text-sm" htmlFor="lesson-assistant-answer">Your answer (optional, for mistake feedback)</label>
    <textarea id="lesson-assistant-answer" maxLength={1200} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Share your thinking" className="mt-1 min-h-16 w-full rounded-lg border border-white/10 bg-[#211638] p-3" />
    <div className="mt-3 flex flex-wrap gap-2">{actions.map(action => <button key={action.value} type="button" disabled={disabled || busy} onClick={() => void ask(action.value)} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Thinking…' : action.label}</button>)}</div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {reply && <div aria-live="polite" className="mt-4 rounded-lg border border-white/10 bg-[#211638] p-4"><h3 className="text-sm font-medium text-[#efc778]">Lesson help</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{reply}</p></div>}
  </aside>;
}
