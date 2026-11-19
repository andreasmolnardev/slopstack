import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { getCourseProgress } from '../api/generated/sdk.gen';
import { client as generatedClient } from '../api/generated/client.gen';
import { learningQueryOptions } from '../api/learning-queries';
import {
  offlineLearningStore,
  syncQueuedAssessments,
  type DownloadedLesson,
  type PendingOfflineAssessment,
} from '../api/offline-learning';
import { pb } from '../api/pocketbase';
import { Starburst } from '../starburst';

export const Route = createFileRoute('/offline')({
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  component: OfflineLibrary,
});

function OfflineLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ownerId, setOwnerId] = useState(pb.authStore.model?.id ?? '');
  const [authReady, setAuthReady] = useState(pb.authStore.isValid);
  const [online, setOnline] = useState(navigator.onLine);
  const [selectedCourse, setSelectedCourse] = useState<DownloadedLesson | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<DownloadedLesson | null>(null);
  const [busyCourseId, setBusyCourseId] = useState('');
  const [message, setMessage] = useState('');
  const downloadsQuery = useQuery({
    queryKey: ['offline-library', ownerId],
    queryFn: () => offlineLearningStore.listCourses(ownerId),
    enabled: Boolean(ownerId),
  });
  const queuedAssessmentsQuery = useQuery({
    queryKey: ['offline-assessments', ownerId],
    queryFn: () => offlineLearningStore.listQueuedAssessments(ownerId),
    enabled: Boolean(ownerId),
  });
  const coursesQuery = useQuery({
    ...learningQueryOptions.courses(),
    enabled: Boolean(ownerId) && online,
  });
  const downloads = downloadsQuery.data ?? [];
  const courses = coursesQuery.data ?? [];

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextOwnerId = model?.id ?? '';
    setAuthReady(Boolean(token && model));
    if (nextOwnerId !== ownerId || !token) {
      setOwnerId(nextOwnerId);
      setSelectedCourse(null);
      setSelectedAssessment(null);
      setMessage('');
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/offline' } });
  }), [navigate, ownerId]);

  async function submitAssessmentOnline(attempt: PendingOfflineAssessment) {
    if (!pb.authStore.isValid || pb.authStore.model?.id !== attempt.ownerId) throw new Error('Sign in to the account that downloaded this course.');
    const current = await queryClient.fetchQuery(learningQueryOptions.course(attempt.courseId));
    if (Number(current.version ?? 1) !== attempt.courseVersion) throw new Error('This course changed after the download. Download the latest version before submitting this quiz.');
    const response = await fetch(pb.buildUrl(`/api/learning/courses/${attempt.courseId}/assess`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
      body: JSON.stringify({ answers: attempt.answers, request_id: attempt.requestId }),
    });
    if (!response.ok) throw new Error('Assessment could not be submitted yet. It remains saved on this device.');
  }

  useEffect(() => {
    if (!ownerId || !authReady || !online) return;
    void syncQueuedAssessments(ownerId, offlineLearningStore, submitAssessmentOnline, () => navigator.onLine)
      .then((synced) => {
        if (synced > 0) {
          setMessage(`${synced} offline assessment${synced === 1 ? '' : 's'} submitted and graded.`);
          void queryClient.invalidateQueries({ queryKey: ['offline-assessments', ownerId] });
        }
      });
  }, [authReady, online, ownerId, queryClient]);

  async function queueAssessment(attempt: PendingOfflineAssessment) {
    if (attempt.ownerId !== ownerId || !await offlineLearningStore.getCourse(ownerId, attempt.courseId)) {
      throw new Error('This download is no longer available for this account.');
    }
    await offlineLearningStore.queueAssessment(attempt);
    await queryClient.invalidateQueries({ queryKey: ['offline-assessments', ownerId] });
    const synced = await syncQueuedAssessments(ownerId, offlineLearningStore, submitAssessmentOnline, () => navigator.onLine && pb.authStore.isValid);
    setMessage(synced > 0 ? 'Assessment submitted and graded.' : 'Assessment saved on this device. It will sync when this account is online and the course version is current.');
    return synced > 0;
  }

  async function downloadCourse(courseId: string) {
    setBusyCourseId(courseId);
    setMessage('');
    try {
      const course = await queryClient.fetchQuery(learningQueryOptions.course(courseId));
      const progressResult = await getCourseProgress({ client: generatedClient, path: { id: courseId } });
      const progress = progressResult.error || !progressResult.data
        ? undefined
        : {
            sceneIndex: progressResult.data.scene_index,
            positionSeconds: progressResult.data.position_seconds,
            completed: progressResult.data.completed,
          };
      await offlineLearningStore.saveCourse(ownerId, course, progress);
      await queryClient.invalidateQueries({ queryKey: ['offline-library', ownerId] });
      setMessage(`“${course.title}” is ready offline.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not download this course');
    } finally {
      setBusyCourseId('');
    }
  }

  async function removeCourse(download: DownloadedLesson) {
    const pending = await offlineLearningStore.listQueuedAssessments(ownerId);
    const discardedAssessments = pending.filter((attempt) => attempt.courseId === download.course.id).length;
    await offlineLearningStore.removeCourse(ownerId, download.course.id);
    if (selectedCourse?.course.id === download.course.id) setSelectedCourse(null);
    await queryClient.invalidateQueries({ queryKey: ['offline-library', ownerId] });
    await queryClient.invalidateQueries({ queryKey: ['offline-assessments', ownerId] });
    setMessage(discardedAssessments > 0
      ? `Download removed. ${discardedAssessments} queued assessment${discardedAssessments === 1 ? '' : 's'} for this course were also deleted.`
      : 'Download removed.');
  }

  if (selectedAssessment) {
    return <OfflineAssessment
      download={selectedAssessment}
      ownerId={ownerId}
      onExit={() => setSelectedAssessment(null)}
      onSubmit={queueAssessment}
    />;
  }

  if (selectedCourse) {
    return <Starburst
      initialCourse={selectedCourse.course}
      offlineMode
      onOfflineExit={() => setSelectedCourse(null)}
    />;
  }

  return (
    <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="text-sm text-[#b7adcc]">← Learning space</Link>
        <header className="mt-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[.2em] text-[#e57fab]">Offline learning</p>
            <h1 className="mt-2 text-3xl font-semibold">Your downloaded lessons</h1>
            <p className="mt-2 max-w-xl text-sm text-[#b7adcc]">Downloaded lesson text and activities stay on this device. Resume progress syncs when you reconnect.</p>
            {(queuedAssessmentsQuery.data?.length ?? 0) > 0 && <p role="status" className="mt-2 text-sm text-[#efc778]">{queuedAssessmentsQuery.data?.length} assessment{queuedAssessmentsQuery.data?.length === 1 ? '' : 's'} waiting for an online, authenticated grading sync.</p>}
          </div>
          <p role="status" className={`rounded-full border px-3 py-1.5 text-sm ${online ? 'border-emerald-300/30 text-emerald-200' : 'border-amber-300/30 text-amber-200'}`}>
            {online ? 'Online · progress syncing enabled' : 'Offline · progress saves on this device'}
          </p>
        </header>

        {downloadsQuery.error && <p role="alert" className="mt-6 text-rose-200">Could not read this device’s offline library.</p>}
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Available downloads</h2>
          {!online && <p className="mt-2 text-sm text-[#b7adcc]">Connect to download more lessons. Your saved lessons are below.</p>}
          {online && coursesQuery.isLoading && <p className="mt-4 text-sm text-[#b7adcc]">Loading your courses…</p>}
          {online && coursesQuery.error && <p role="alert" className="mt-4 text-sm text-rose-200">Could not load courses to download.</p>}
          {online && courses.length > 0 && <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {courses.map((course) => {
              const downloaded = downloads.some((item) => item.course.id === course.id);
              return <li key={course.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#211638] p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{course.title}</p>
                  <p className="mt-1 text-xs text-[#b7adcc]">{course.content?.modules && Array.isArray(course.content.modules) ? course.content.modules.length : 0} modules</p>
                </div>
                <button
                  disabled={busyCourseId === course.id || downloaded || !course.content}
                  onClick={() => void downloadCourse(course.id)}
                  className="shrink-0 rounded-lg bg-[#6350c8] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >{busyCourseId === course.id ? 'Downloading…' : downloaded ? 'Downloaded' : 'Download'}</button>
              </li>;
            })}
          </ul>}
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Saved on this device</h2>
          {downloadsQuery.isPending && <p className="mt-4 text-sm text-[#b7adcc]">Checking local downloads…</p>}
          {!downloadsQuery.isPending && downloads.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-white/15 p-6 text-sm text-[#b7adcc]">No lessons downloaded yet.</p>}
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {downloads.map((download) => <li key={download.course.id} className="rounded-xl border border-white/10 bg-[#211638] p-5">
              <p className="text-xs uppercase tracking-wider text-[#efc778]">Downloaded {new Date(download.downloadedAt).toLocaleDateString()}</p>
              <h3 className="mt-2 text-lg font-medium">{download.course.title}</h3>
              <p className="mt-1 text-sm text-[#b7adcc]">{download.course.description || 'Lesson saved for offline reading.'}</p>
              {assessmentQuestions(download.course).length > 0 && <p className="mt-2 text-xs text-[#b7adcc]">Removing this download also deletes any queued assessment answers for the course.</p>}
              <div className="mt-4 flex gap-2">
                <button onClick={() => setSelectedCourse(download)} className="rounded-lg bg-[#6350c8] px-4 py-2 text-sm">Read offline</button>
                {assessmentQuestions(download.course).length > 0 && <button onClick={() => setSelectedAssessment(download)} className="rounded-lg border border-[#e57fab]/40 px-3 py-2 text-sm text-[#f1b3cf]">Practice offline</button>}
                <button onClick={() => void removeCourse(download)} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Remove</button>
              </div>
            </li>)}
          </ul>
        </section>
        {message && <p role="status" className="mt-6 text-sm text-[#efc778]">{message}</p>}
      </div>
    </main>
  );
}

type OfflineQuestion = {
  id: string;
  type: string;
  prompt: string;
  audio_text?: string;
  objective?: string;
  points?: number;
  choices?: string[];
  items?: string[];
  left_items?: string[];
  right_items?: string[];
};

function assessmentQuestions(course: DownloadedLesson['course']): OfflineQuestion[] {
  const content = course.content as { modules?: Array<{ assessment?: { questions?: OfflineQuestion[] } }> } | undefined;
  return content?.modules?.flatMap((module) => module.assessment?.questions ?? []) ?? [];
}

function OfflineAssessment({ download, ownerId, onExit, onSubmit }: {
  download: DownloadedLesson;
  ownerId: string;
  onExit: () => void;
  onSubmit: (attempt: PendingOfflineAssessment) => Promise<boolean>;
}) {
  const questions = assessmentQuestions(download.course);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const version = Number(download.course.version ?? 1);
  const allAnswered = questions.every((question) => {
    const value = answers[question.id];
    if (question.type === 'true_false') return typeof value === 'boolean';
    if (question.type === 'multiple_select' || question.type === 'ordering') return Array.isArray(value) && value.length > 0;
    if (question.type === 'matching') return Object.keys((value as Record<string, string> | undefined) ?? {}).length === (question.left_items?.length ?? 0);
    return value !== undefined && String(value).trim() !== '';
  });

  function answer(question: OfflineQuestion, value: unknown) {
    setAnswers((current) => ({ ...current, [question.id]: value }));
  }

  function playListening(question: OfflineQuestion) {
    if (!('speechSynthesis' in window)) {
      setNotice('This browser has no installed speech voice for offline listening.');
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(question.audio_text ?? ''));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const requestId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const online = await onSubmit({
        ownerId,
        courseId: download.course.id,
        courseVersion: version,
        requestId,
        answers,
        queuedAt: Date.now(),
      });
      setSubmitted(true);
      setNotice(online ? 'Submitted and graded.' : 'Saved on this device. It will be graded after this account reconnects with the current course version.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this assessment');
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]">
    <div className="mx-auto max-w-3xl">
      <button onClick={onExit} className="text-sm text-[#b7adcc]">← Offline library</button>
      <header className="mt-7">
        <p className="text-sm uppercase tracking-[.2em] text-[#e57fab]">Offline assessment</p>
        <h1 className="mt-2 text-3xl font-semibold">{download.course.title}</h1>
        <p className="mt-2 text-sm text-[#b7adcc]">Answer keys stay on the server. Your answers are stored on this device and sent for grading when you are online, signed in, and using the current course version.</p>
      </header>
      <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
        {questions.map((question, index) => <fieldset key={question.id} className="rounded-xl border border-white/10 bg-[#211638] p-5">
          <legend className="px-1 text-sm text-[#efc778]">Question {index + 1} · {question.type.replaceAll('_', ' ')}</legend>
          <p className="font-medium">{question.prompt}</p>
          {question.objective && <p className="mt-1 text-xs text-[#b7adcc]">{question.objective}</p>}
          {question.type === 'listening' && <button type="button" onClick={() => playListening(question)} className="mt-3 rounded bg-[#6350c8] px-3 py-2">Listen to prompt</button>}
          {question.type === 'listening' && <div className="mt-3 grid gap-2">{question.choices?.map((choice) => <label key={choice} className="flex gap-2 text-sm"><input type="radio" name={question.id} checked={answers[question.id] === choice} onChange={() => answer(question, choice)}/>{choice}</label>)}</div>}
          {question.type === 'multiple_choice' && <select required aria-label={`Answer question ${index + 1}`} value={String(answers[question.id] ?? '')} onChange={(event) => answer(question, event.target.value)} className="mt-3 w-full rounded-lg bg-[#0e0621] p-3"><option value="">Choose an answer</option>{question.choices?.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>}
          {question.type === 'true_false' && <select required aria-label={`Answer question ${index + 1}`} value={answers[question.id] === undefined ? '' : String(answers[question.id])} onChange={(event) => answer(question, event.target.value === 'true')} className="mt-3 rounded-lg bg-[#0e0621] p-3"><option value="">Choose true or false</option><option value="true">True</option><option value="false">False</option></select>}
          {question.type === 'multiple_select' && <div className="mt-3 grid gap-2">{question.choices?.map((choice) => { const selected = (answers[question.id] as string[] | undefined) ?? []; return <label key={choice} className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(choice)} onChange={(event) => answer(question, event.target.checked ? [...selected, choice] : selected.filter((item) => item !== choice))}/>{choice}</label>; })}</div>}
          {question.type === 'ordering' && <div className="mt-3 grid gap-2"><p className="text-xs text-[#b7adcc]">Enter the items in the order you choose, separated by commas.</p><input aria-label={`Ordered answer for question ${index + 1}`} value={Array.isArray(answers[question.id]) ? (answers[question.id] as string[]).join(', ') : (answers[question.id] as string | undefined) ?? ''} onChange={(event) => answer(question, event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} className="rounded-lg bg-[#0e0621] p-3" placeholder={question.items?.join(', ')}/></div>}
          {question.type === 'matching' && <div className="mt-3 grid gap-2">{question.left_items?.map((left) => <label key={left} className="grid gap-1 text-sm sm:grid-cols-[1fr_1fr] sm:items-center"><span>{left}</span><select required aria-label={`Match ${left}`} value={(answers[question.id] as Record<string, string> | undefined)?.[left] ?? ''} onChange={(event) => answer(question, { ...answers[question.id] as Record<string, string>, [left]: event.target.value })} className="rounded-lg bg-[#0e0621] p-2"><option value="">Choose a match</option>{question.right_items?.map((right) => <option key={right} value={right}>{right}</option>)}</select></label>)}</div>}
          {!['multiple_choice', 'listening', 'true_false', 'multiple_select', 'ordering', 'matching'].includes(question.type) && <input required aria-label={`Answer question ${index + 1}`} value={String(answers[question.id] ?? '')} onChange={(event) => answer(question, event.target.value)} className="mt-3 w-full rounded-lg bg-[#0e0621] p-3" placeholder="Your answer"/>}
        </fieldset>)}
        {questions.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-5">This download has no assessment questions.</p>}
        <div className="flex flex-wrap gap-3"><button disabled={busy || submitted || questions.length === 0 || !allAnswered} className="rounded-lg bg-[#6350c8] px-4 py-2 disabled:opacity-50">{busy ? 'Saving…' : submitted ? 'Assessment saved' : 'Submit for grading'}</button><button type="button" onClick={onExit} className="rounded-lg border border-white/15 px-4 py-2">Back</button></div>
        {!submitted && questions.length > 0 && !allAnswered && <p className="text-xs text-[#b7adcc]">Answer each question before submitting. Grading happens on the server after sync.</p>}
        {notice && <p role="status" className="text-sm text-[#efc778]">{notice}</p>}
      </form>
    </div>
  </main>;
}
