import { useEffect, useState } from 'react';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { learningQueryOptions, type DueReview, type LearningRecord } from '../api/learning-queries';
import { pb } from '../api/pocketbase';

export const Route = createFileRoute('/practice')({
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(learningQueryOptions.knowledgeUnits()),
    context.queryClient.ensureQueryData(learningQueryOptions.dueReviews()),
    context.queryClient.ensureQueryData(learningQueryOptions.courses()),
  ]),
  component: AdaptivePractice,
});

type PracticeMode = 'selected' | 'due' | 'weak' | 'mixed' | 'gap' | 'course' | 'module';
type PracticeQuestion = { id: string; unit_id: string; unit_title: string; reason?: string; difficulty: 'recognition' | 'recall'; prompt: string; options: string[]; hints: string[] };
type PracticeQuiz = { id: string; mode: PracticeMode; questions: PracticeQuestion[] };
type PracticeResult = { score: number; correct: number; total: number; results: Array<{ question_id: string; unit_id: string; correct: boolean; feedback: string; remediation: string }> };

function AdaptivePractice() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ownerId, setOwnerId] = useState(pb.authStore.model?.id ?? '');
  const unitsQuery = useQuery({ ...learningQueryOptions.knowledgeUnits(), enabled: Boolean(ownerId) });
  const dueQuery = useQuery({ ...learningQueryOptions.dueReviews(), enabled: Boolean(ownerId) });
  const coursesQuery = useQuery({ ...learningQueryOptions.courses(), enabled: Boolean(ownerId) });
  const [mode, setMode] = useState<PracticeMode>('selected');
  const [selectedIDs, setSelectedIDs] = useState<string[]>([]);
  const [courseID, setCourseID] = useState('');
  const [moduleID, setModuleID] = useState('');
  const courseQuery = useQuery({ ...learningQueryOptions.course(courseID), enabled: Boolean(ownerId && courseID) });
  const [quiz, setQuiz] = useState<PracticeQuiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hintsRevealed, setHintsRevealed] = useState<Record<string, number>>({});
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const units = (unitsQuery.data ?? []) as LearningRecord[];
  const dueReviews = (dueQuery.data ?? []) as DueReview[];

  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextOwnerID = model?.id ?? '';
    if (nextOwnerID !== ownerId || !token) {
      setOwnerId(nextOwnerID);
      setSelectedIDs([]);
      setCourseID('');
      setModuleID('');
      setQuiz(null);
      setAnswers({});
      setHintsRevealed({});
      setResult(null);
      queryClient.clear();
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/practice' } });
  }), [navigate, ownerId, queryClient]);

  const dueIDs = new Set(dueReviews.map((review) => review.unit.id));
  const weakIDs = new Set(dueReviews.filter((review) => review.mastery <= 0.6).map((review) => review.unit.id));
  const selectionRequired = mode === 'selected';
  const selectionAllowed = mode === 'selected' || mode === 'mixed' || mode === 'gap';
  const courseRequired = mode === 'course' || mode === 'module';
  const courseModules = ((courseQuery.data?.content?.curriculum as { modules?: Array<{ id?: string; title?: string }> } | undefined)?.modules ?? []).filter((module) => Boolean(module.id));

  async function startPractice(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setQuiz(null);
    setResult(null);
    try {
      const response = await pb.send<PracticeQuiz>('/api/learning/practice/quizzes', {
        method: 'POST',
        body: {
          mode,
          unit_ids: selectionAllowed ? selectedIDs : [],
          ...(courseRequired ? { course_id: courseID } : {}),
          ...(mode === 'module' ? { module_id: moduleID } : {}),
        },
      });
      setQuiz(response);
      setAnswers({});
      setHintsRevealed({});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start practice.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswers(event: React.FormEvent) {
    event.preventDefault();
    if (!quiz) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await pb.send<PracticeResult>(`/api/learning/practice/quizzes/${quiz.id}/submit`, {
        method: 'POST',
        body: { answers },
      });
      setResult(response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['learning', 'knowledge-evidence', ownerId] }),
        queryClient.invalidateQueries({ queryKey: ['learning', 'reviews', 'due', ownerId] }),
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit this practice round.');
    } finally {
      setBusy(false);
    }
  }

  function revealHint(questionID: string, maxHints: number) {
    setHintsRevealed((current) => ({ ...current, [questionID]: Math.min(maxHints, (current[questionID] ?? 0) + 1) }));
  }

  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]">
    <div className="mx-auto max-w-4xl">
      <Link to="/knowledge" className="text-sm text-[#c6b7dd]">← Knowledge map</Link>
      <header className="mt-8">
        <p className="text-sm uppercase tracking-[.2em] text-[#e57fab]">Adaptive practice</p>
        <h1 className="mt-2 text-4xl font-semibold">Practice what needs attention</h1>
        <p className="mt-3 max-w-2xl text-[#b7adcc]">Build a recall quiz from selected concepts, due reviews, knowledge gaps, or a course module. Hints reveal one step at a time; missed ideas include a saved explanation to revisit.</p>
      </header>

      {!quiz && <form onSubmit={startPractice} className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-[#211638] p-6">
        <label className="grid gap-2 text-sm">Practice set<select value={mode} onChange={(event) => { setMode(event.target.value as PracticeMode); setModuleID(''); }} className="rounded-lg bg-[#0e0621] p-3"><option value="selected">Selected concepts</option><option value="due">Reviews due today</option><option value="weak">Lower mastery</option><option value="gap">New and weak concepts</option><option value="mixed">Mix due reviews with selected concepts</option><option value="course">Entire course</option><option value="module">Course module</option></select></label>
        {courseRequired && <>
          <label className="grid gap-2 text-sm">Course<select value={courseID} onChange={(event) => { setCourseID(event.target.value); setModuleID(''); }} className="rounded-lg bg-[#0e0621] p-3"><option value="">Choose a course</option>{(coursesQuery.data ?? []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          {mode === 'module' && <label className="grid gap-2 text-sm">Module<select value={moduleID} onChange={(event) => setModuleID(event.target.value)} disabled={!courseID || courseQuery.isLoading} className="rounded-lg bg-[#0e0621] p-3"><option value="">Choose a module</option>{courseModules.map((module) => <option key={module.id} value={module.id}>{module.title || module.id}</option>)}</select></label>}
          <p className="text-sm text-[#b7adcc]">Questions use generated knowledge units attached to this course, up to 40 items.</p>
        </>}
        {selectionAllowed && <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{mode === 'gap' ? 'Focus concepts (optional)' : 'Choose knowledge items'} <span className="text-xs text-[#b7adcc]">(up to 20)</span></legend>
          {unitsQuery.isLoading ? <p className="text-sm text-[#b7adcc]">Loading your knowledge items…</p> : units.length === 0 ? <p className="text-sm text-[#b7adcc]">Add knowledge items before creating a custom practice set.</p> : <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-white/10 p-3">{units.map((unit) => <label key={unit.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white/5">
            <input type="checkbox" checked={selectedIDs.includes(unit.id)} disabled={!selectedIDs.includes(unit.id) && selectedIDs.length >= 20} onChange={(event) => setSelectedIDs((current) => event.target.checked ? [...current, unit.id].slice(0, 20) : current.filter((id) => id !== unit.id))} className="mt-1 accent-[#e57fab]" />
            <span><span className="block text-sm">{unit.title}</span><span className="mt-1 block text-xs text-[#b7adcc]">{unit.unit_type?.replaceAll('_', ' ') ?? 'knowledge'}{dueIDs.has(unit.id) ? ' · review due' : ''}{weakIDs.has(unit.id) ? ' · lower mastery' : ''}</span></span>
          </label>)}</div>}
        </fieldset>}
        {mode === 'due' && <p className="text-sm text-[#b7adcc]">{dueQuery.isLoading ? 'Checking your review schedule…' : `${dueReviews.length} item${dueReviews.length === 1 ? '' : 's'} currently due.`}</p>}
        {mode === 'weak' && <p className="text-sm text-[#b7adcc]">Lower mastery includes concepts with a saved mastery score of 60% or less.</p>}
        {mode === 'gap' && <p className="text-sm text-[#b7adcc]">Choose a focus concept to find its missing prerequisites, or leave blank to review new and weak concepts.</p>}
        <button disabled={busy || unitsQuery.isLoading || (selectionRequired && selectedIDs.length === 0) || (mode === 'mixed' && selectedIDs.length === 0 && (dueQuery.isLoading || dueReviews.length === 0)) || (courseRequired && (!courseID || (mode === 'module' && (!moduleID || courseQuery.isLoading))))} className="w-fit rounded-lg bg-[#6350c8] px-5 py-2.5 disabled:opacity-50">{busy ? 'Preparing practice…' : 'Start practice'}</button>
      </form>}

      {quiz && !result && <form onSubmit={submitAnswers} className="mt-8 space-y-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Practice round</h2><span className="text-sm text-[#b7adcc]">{quiz.questions.length} questions</span></div>
        {quiz.questions.map((question, index) => {
          const revealed = hintsRevealed[question.id] ?? 0;
          return <fieldset key={question.id} className="rounded-2xl border border-white/10 bg-[#211638] p-5">
            <legend className="px-2 text-lg font-medium">{index + 1}. {question.prompt}</legend>
            <p className="mb-3 text-xs uppercase tracking-wider text-[#efc778]">{question.unit_title}</p>
            {question.reason && <p className="mb-3 text-xs text-[#b7adcc]">{question.reason}</p>}
            <p className="mb-3 text-xs text-[#b7adcc]">{question.difficulty === 'recall' ? 'Recall challenge · identify the concept from its explanation' : 'Concept recall · match the concept to its explanation'}</p>
            <div className="space-y-2">{question.options.map((option) => <label key={`${question.id}:${option}`} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-[#0e0621] p-3 hover:border-[#aa65c9]">
              <input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} className="mt-1 accent-[#e57fab]" />
              <span className="text-sm leading-6">{option}</span>
            </label>)}</div>
            {revealed > 0 && <ol aria-label={`Hints for ${question.unit_title}`} className="mt-4 list-decimal space-y-1 pl-5 text-sm text-[#efc778]">{question.hints.slice(0, revealed).map((hint) => <li key={hint}>{hint}</li>)}</ol>}
            {revealed < question.hints.length && <button type="button" onClick={() => revealHint(question.id, question.hints.length)} className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-sm">Reveal hint {revealed + 1}</button>}
          </fieldset>;
        })}
        <div className="flex flex-wrap gap-3"><button disabled={busy || Object.keys(answers).length !== quiz.questions.length} className="rounded-lg bg-[#6350c8] px-5 py-2.5 disabled:opacity-50">{busy ? 'Checking answers…' : 'Check answers'}</button><button type="button" onClick={() => { setQuiz(null); setAnswers({}); setHintsRevealed({}); }} className="rounded-lg border border-white/15 px-5 py-2.5">Cancel round</button></div>
      </form>}

      {quiz && result && <section aria-live="polite" className="mt-8 rounded-2xl border border-white/10 bg-[#211638] p-6">
        <p className="text-sm uppercase tracking-wider text-[#efc778]">Practice complete</p>
        <h2 className="mt-2 text-3xl font-semibold">{result.correct} of {result.total} correct</h2>
        <p className="mt-2 text-sm text-[#b7adcc]">Score {Math.round(result.score * 100)}% · your evidence and review schedule have been updated.</p>
        <ol className="mt-5 space-y-3">{result.results.map((item, index) => <li key={item.question_id} className="rounded-xl bg-[#0e0621] p-4"><p className={item.correct ? 'text-emerald-200' : 'text-amber-200'}>{index + 1}. {item.correct ? 'Correct' : 'Review this concept'}</p><p className="mt-1 text-sm text-[#d4cde2]">{item.feedback}</p>{!item.correct && item.remediation && <div className="mt-3 rounded-lg border border-[#efc778]/25 bg-[#211638] p-3"><p className="text-xs uppercase tracking-wider text-[#efc778]">Alternative explanation</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{item.remediation}</p></div>}</li>)}</ol>
        <button onClick={() => { setQuiz(null); setResult(null); setAnswers({}); setHintsRevealed({}); }} className="mt-5 rounded-lg bg-[#6350c8] px-5 py-2.5">Practice again</button>
      </section>}

      {message && <p role="alert" className="mt-5 rounded-lg border border-rose-300/25 bg-rose-950/30 p-4 text-sm text-rose-200">{message}</p>}
      <div className="mt-8 rounded-xl border border-white/10 p-4 text-sm text-[#b7adcc]"><p>Practice is built from the saved definitions in your knowledge library. Improve a quiz by adding clear definitions and useful prerequisite links to your concepts.</p><Link to="/knowledge" className="mt-2 inline-block text-[#e57fab]">Review knowledge items →</Link></div>
    </div>
  </main>;
}
