import { useEffect, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../api/pocketbase';
import { preferencesQueryOptions, savePreferences } from '../api/preferences';
import { learnerProfileForm, learnerProfilePatch, type LearnerProfileForm } from '../profile/preferences-form';

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ location }) => { if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } }); },
  loader: ({ context }) => context.queryClient.ensureQueryData(preferencesQueryOptions()),
  component: LearnerProfile,
});

const blankForm: LearnerProfileForm = {
  learningInterests: '', learningGoals: '', priorKnowledge: '', preferredLanguage: 'en',
  defaultDifficulty: 'intermediate', targetMinutes: 20, narration: true, captions: true,
};

function LearnerProfile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery(preferencesQueryOptions());
  const [form, setForm] = useState(blankForm);
  const [message, setMessage] = useState('');
  const [authUserId, setAuthUserId] = useState(pb.authStore.model?.id);
  useEffect(() => { if (preferencesQuery.data) setForm(learnerProfileForm(preferencesQuery.data)); }, [preferencesQuery.data]);
  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextUserId = model?.id;
    if (authUserId !== nextUserId || !token) { setAuthUserId(nextUserId); setForm(blankForm); setMessage(''); }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/profile' } });
  }), [authUserId, navigate]);
  const save = useMutation({
    mutationFn: savePreferences,
    onSuccess: preferences => { queryClient.setQueryData(preferencesQueryOptions().queryKey, preferences); setMessage('Learner profile saved.'); },
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try { await save.mutateAsync(learnerProfilePatch(form)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save learner profile.'); }
  }
  function update<K extends keyof LearnerProfileForm>(key: K, value: LearnerProfileForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]"><div className="mx-auto max-w-3xl">
    <a href="/" className="text-sm text-[#c6b7dd]">← Starburst</a>
    <p className="mt-8 text-sm uppercase tracking-[.2em] text-[#e57fab]">Learner profile</p>
    <h1 className="mt-2 text-4xl font-semibold">Set your learning preferences</h1>
    <p className="mt-3 text-[#b7adcc]">These settings stay with your account and help shape future learning plans and lesson presentation.</p>
    {preferencesQuery.isLoading ? <p className="mt-8">Loading your profile…</p> : preferencesQuery.error ? <p role="alert" className="mt-8 text-rose-300">Could not load learner preferences.</p> : <form onSubmit={submit} className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-[#211638] p-6">
      <label className="grid gap-2 text-sm">Learning interests <span className="text-xs text-[#b7adcc]">One per line, up to 20</span><textarea value={form.learningInterests} onChange={event => update('learningInterests', event.target.value)} maxLength={2200} className="min-h-24 rounded-lg bg-[#0e0621] p-3" placeholder={'Astronomy\nMusic'} /></label>
      <label className="grid gap-2 text-sm">Learning goals <span className="text-xs text-[#b7adcc]">One per line, up to 20</span><textarea value={form.learningGoals} onChange={event => update('learningGoals', event.target.value)} maxLength={2200} className="min-h-24 rounded-lg bg-[#0e0621] p-3" placeholder={'Read research papers\nBuild a small app'} /></label>
      <label className="grid gap-2 text-sm">Prior knowledge <span className="text-xs text-[#b7adcc]">One per line, up to 20</span><textarea value={form.priorKnowledge} onChange={event => update('priorKnowledge', event.target.value)} maxLength={2200} className="min-h-24 rounded-lg bg-[#0e0621] p-3" placeholder={'Basic algebra\nSome Python'} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">Preferred language<input value={form.preferredLanguage} onChange={event => update('preferredLanguage', event.target.value)} maxLength={35} placeholder="en or fr-CA" className="rounded-lg bg-[#0e0621] p-3" /></label>
        <label className="grid gap-2 text-sm">Default difficulty<select value={form.defaultDifficulty} onChange={event => update('defaultDifficulty', event.target.value)} className="rounded-lg bg-[#0e0621] p-3"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label className="grid gap-2 text-sm">Target lesson length (minutes)<input type="number" min={5} max={60} step={1} value={form.targetMinutes} onChange={event => update('targetMinutes', Number(event.target.value))} className="rounded-lg bg-[#0e0621] p-3" /></label>
      </div>
      <fieldset className="grid gap-3"><legend className="text-sm font-medium">Lesson presentation</legend>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.narration} onChange={event => update('narration', event.target.checked)} />Narration</label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.captions} onChange={event => update('captions', event.target.checked)} />Captions</label>
      </fieldset>
      <div className="flex items-center gap-4"><button disabled={save.isPending} className="rounded-lg bg-[#6350c8] px-5 py-2.5">{save.isPending ? 'Saving…' : 'Save profile'}</button>{message && <p role="status" className="text-sm text-[#efc778]">{message}</p>}</div>
    </form>}
  </div></main>;
}
