import { useEffect, useRef, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../api/pocketbase';
import { learningQueryOptions } from '../api/learning-queries';
import { SpeechVoicePicker } from '../speech-voice-picker';
import { preferencesQueryOptions } from '../api/preferences';
import { createPodcast, deletePodcast, emptyPodcastVoiceAssignments, podcastQueryOptions, regeneratePodcast, savePodcastScript, savePodcastVoices, type PodcastEpisode, type PodcastScriptDraft, type PodcastVoiceAssignments } from '../api/podcasts';

export const Route = createFileRoute('/audio')({
  beforeLoad: ({ location }) => { if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } }); },
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(podcastQueryOptions.episodes()),
    context.queryClient.ensureQueryData(learningQueryOptions.sources()),
    context.queryClient.ensureQueryData(learningQueryOptions.knowledgeUnits()),
    context.queryClient.ensureQueryData(learningQueryOptions.courses()),
    context.queryClient.ensureQueryData(learningQueryOptions.piperHealth()),
    context.queryClient.ensureQueryData(preferencesQueryOptions()),
  ]),
  component: AudioStudio,
});

function AudioStudio() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const episodesQuery = useQuery(podcastQueryOptions.episodes());
  const sourcesQuery = useQuery(learningQueryOptions.sources());
  const unitsQuery = useQuery(learningQueryOptions.knowledgeUnits());
  const coursesQuery = useQuery(learningQueryOptions.courses());
  const piperQuery = useQuery(learningQueryOptions.piperHealth());
  const preferencesQuery = useQuery(preferencesQueryOptions());
  const piperReady = Boolean(piperQuery.data?.configured && piperQuery.data.connected);
  const [title, setTitle] = useState(''); const [topic, setTopic] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]); const [conceptIds, setConceptIds] = useState<string[]>([]);
  const [courseId, setCourseId] = useState(''); const [moduleId, setModuleId] = useState('');
  const [active, setActive] = useState<PodcastEpisode | null>(null); const [turn, setTurn] = useState(0);
  const [editing, setEditing] = useState(false); const [scriptDraft, setScriptDraft] = useState<PodcastScriptDraft | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [speed, setSpeed] = useState(1);
  const [queuePlayback, setQueuePlayback] = useState(false);
  const [narrationVoice, setNarrationVoice] = useState('');
  const [narrationSpeaker, setNarrationSpeaker] = useState('');
  const [authUserId, setAuthUserId] = useState(pb.authStore.model?.id);
  const [audioUrl, setAudioUrl] = useState(''); const audioRef = useRef<HTMLAudioElement>(null);
  const playWhenReady = useRef(false);
  const episodes = episodesQuery.data ?? [];
  const selectedCourse = (coursesQuery.data ?? []).find(course => course.id === courseId);
  const modules = (Array.isArray(selectedCourse?.content?.modules) ? selectedCourse.content.modules : []) as Array<{ id?: string; title?: string }>;
  useEffect(() => {
    setNarrationVoice(preferencesQuery.data?.narrationVoice ?? '');
    setNarrationSpeaker(preferencesQuery.data?.narrationSpeaker ?? '');
  }, [preferencesQuery.data?.narrationVoice, preferencesQuery.data?.narrationSpeaker]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => {
    if (!audioUrl || !audioRef.current) return;
    audioRef.current.playbackRate = speed;
    if (playWhenReady.current) { playWhenReady.current = false; void audioRef.current.play(); }
  }, [audioUrl, speed]);
  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextUserId = model?.id;
    if (authUserId !== nextUserId || !token) {
      setAuthUserId(nextUserId);
      setActive(null);
      setEditing(false);
      setScriptDraft(null);
      setAudioUrl('');
      setQueuePlayback(false);
      setTitle('');
      setTopic('');
      setSourceIds([]);
      setConceptIds([]);
      setCourseId(''); setModuleId('');
      setNarrationVoice('');
      setNarrationSpeaker('');
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/audio' } });
  }), [authUserId, navigate]);
  async function refresh() { await client.invalidateQueries({ queryKey: podcastQueryOptions.episodes().queryKey }); }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice('');
    try { const episode = await createPodcast({ title, topic, source_ids: sourceIds, concept_ids: conceptIds, ...(courseId ? { course_id: courseId, ...(moduleId ? { module_id: moduleId } : {}) } : {}) }); setTitle(''); setTopic(''); setCourseId(''); setModuleId(''); setActive(episode); setScriptDraft({ outline: episode.outline, transcript: episode.transcript }); setEditing(false); setTurn(0); setQueuePlayback(false); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create episode'); } finally { setBusy(false); }
  }
  async function synthesize(index = turn, queued = false) {
    if (!active) return;
    if (!piperReady) { setNotice(piperQuery.data?.configured ? 'Piper is configured but disconnected. The transcript is ready; audio is unavailable.' : 'Piper is not configured. The transcript is ready; audio is unavailable.'); return; }
    setBusy(true); setNotice(`Creating Piper audio for turn ${index + 1}…`);
    try {
      const line = active.transcript.turns[index];
      const assigned = active.voice_assignments?.[line.speaker] ?? emptyPodcastVoiceAssignments()[line.speaker];
      const response = await fetch(pb.buildUrl('/api/speech/synthesize'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token }, body: JSON.stringify({ text: line.text, voice: assigned.voice || narrationVoice, speaker: assigned.voice ? assigned.speaker : narrationSpeaker }) });
      if (!response.ok) throw new Error('Piper could not synthesize this turn');
      const url = URL.createObjectURL(await response.blob()); playWhenReady.current = true; setAudioUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
      setNotice(`${line.speaker === 'host' ? 'Host' : 'Guest'} turn ready.${queued ? ` Playing turn ${index + 1} of ${active.transcript.turns.length}.` : ''}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Audio generation failed'); } finally { setBusy(false); }
  }
  async function remove(episode: PodcastEpisode) { try { await deletePodcast(episode.id); if (active?.id === episode.id) setActive(null); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete episode'); } }
  async function regenerate(episode: PodcastEpisode) { setBusy(true); try { const updated = await regeneratePodcast(episode.id); setActive(updated); setScriptDraft({ outline: updated.outline, transcript: updated.transcript }); setEditing(false); setTurn(0); setQueuePlayback(false); setAudioUrl(''); await refresh(); setNotice('Episode script regenerated.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not regenerate episode'); } finally { setBusy(false); } }
  function selectEpisode(episode: PodcastEpisode) { setActive(episode); setScriptDraft({ outline: episode.outline, transcript: episode.transcript }); setEditing(false); setTurn(0); setAudioUrl(''); setQueuePlayback(false); }
  function beginEditing() { if (!active) return; setScriptDraft({ outline: structuredClone(active.outline), transcript: structuredClone(active.transcript) }); setEditing(true); setNotice(''); }
  async function saveScript() {
    if (!active || !scriptDraft) return;
    setBusy(true); setNotice('');
    try { const updated = await savePodcastScript(active.id, scriptDraft); setActive(updated); setScriptDraft({ outline: updated.outline, transcript: updated.transcript }); setEditing(false); setAudioUrl(''); setTurn(Math.min(turn, updated.transcript.turns.length - 1)); await refresh(); setNotice('Script edits saved.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save script edits'); }
    finally { setBusy(false); }
  }
  async function updateRoleVoice(role: 'host' | 'guest', voice: string, speaker: string) {
    if (!active) return;
    const assignments: PodcastVoiceAssignments = { ...emptyPodcastVoiceAssignments(), ...(active.voice_assignments ?? {}), [role]: { voice, speaker } };
    setBusy(true); setNotice('Saving voice assignment…');
    try {
      const updated = await savePodcastVoices(active.id, assignments);
      if (active?.id === updated.id) setActive(updated);
      await refresh(); setNotice(`${role === 'host' ? 'Host' : 'Guest'} voice saved.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save voice assignment'); }
    finally { setBusy(false); }
  }
  function updateDraftOutline(update: (current: PodcastScriptDraft['outline']) => PodcastScriptDraft['outline']) { setScriptDraft(current => current ? { ...current, outline: update(current.outline) } : current); }
  function updateDraftTurn(index: number, update: (current: PodcastScriptDraft['transcript']['turns'][number]) => PodcastScriptDraft['transcript']['turns'][number]) { setScriptDraft(current => current ? { ...current, transcript: { turns: current.transcript.turns.map((line, lineIndex) => lineIndex === index ? update(line) : line) } } : current); }
  function selectTurn(index: number) { const next = Math.max(0, Math.min(index, (active?.transcript.turns.length ?? 1) - 1)); setTurn(next); setAudioUrl(''); setQueuePlayback(false); }
  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]"><div className="mx-auto max-w-5xl">
    <a href="/" className="text-sm text-[#c6b7dd]">← Starburst</a><p className="mt-8 text-sm uppercase tracking-[.2em] text-[#e57fab]">Audio Studio</p><h1 className="mt-2 text-4xl font-semibold">Make a learning podcast</h1><p className="mt-3 max-w-2xl text-[#b7adcc]">Create an outline and two speaker script from your topic, grounded in your saved sources and concepts.</p>
    <form onSubmit={create} className="mt-8 grid gap-4 rounded-2xl border border-white/10 bg-[#211638] p-6"><h2 className="text-xl font-medium">New episode</h2><input maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} placeholder="Episode title" className="rounded-lg bg-[#0e0621] p-3"/><textarea maxLength={1000} required value={topic} onChange={e => setTopic(e.target.value)} placeholder="What should the conversation teach?" className="min-h-24 rounded-lg bg-[#0e0621] p-3"/>
      <label className="grid gap-2 text-sm">Learning sources (up to 5)<select multiple size={Math.min(4, Math.max(2, sourcesQuery.data?.length ?? 2))} value={sourceIds} onChange={e => setSourceIds(Array.from(e.currentTarget.selectedOptions, option => option.value).slice(0, 5))} className="rounded-lg bg-[#0e0621] p-3">{(sourcesQuery.data ?? []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Concepts (up to 10)<select multiple size={Math.min(4, Math.max(2, unitsQuery.data?.length ?? 2))} value={conceptIds} onChange={e => setConceptIds(Array.from(e.currentTarget.selectedOptions, option => option.value).slice(0, 10))} className="rounded-lg bg-[#0e0621] p-3">{(unitsQuery.data ?? []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Course (optional)<select value={courseId} onChange={event => { setCourseId(event.target.value); setModuleId(''); }} className="rounded-lg bg-[#0e0621] p-3"><option value="">No course context</option>{(coursesQuery.data ?? []).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      {courseId && <label className="grid gap-2 text-sm">Course material<select value={moduleId} onChange={event => setModuleId(event.target.value)} className="rounded-lg bg-[#0e0621] p-3"><option value="">Entire course</option>{modules.map((module, index) => <option key={module.id ?? index} value={module.id ?? ''}>{module.title ?? `Module ${index + 1}`}</option>)}</select><span className="text-xs text-[#b7adcc]">The selected course or module is copied into a bounded episode context for regeneration.</span></label>}
      <button disabled={busy} className="w-fit rounded-lg bg-[#6350c8] px-5 py-2.5">{busy ? 'Working…' : 'Generate episode'}</button>
    </form>
    {notice && <p role="status" className="mt-4 text-sm text-[#efc778]">{notice}</p>}
    <div className="mt-8 grid gap-6 lg:grid-cols-[.75fr_1.25fr]"><section><h2 className="mb-3 text-xl font-semibold">Your episodes</h2>{episodesQuery.error && <p role="alert">Could not load episodes.</p>}{episodes.map(episode => <article key={episode.id} className="mb-3 rounded-xl border border-white/10 bg-[#211638] p-4"><button className="text-left" onClick={() => selectEpisode(episode)}><h3 className="font-medium">{episode.title}</h3><p className="mt-1 text-xs text-[#b7adcc]">{episode.duration_seconds}s · {episode.status}</p></button><div className="mt-3 flex gap-3 text-xs"><button onClick={() => void regenerate(episode)} disabled={busy}>Regenerate</button><button onClick={() => void remove(episode)}>Delete</button></div></article>)}</section>
      <section className="rounded-2xl border border-white/10 bg-[#211638] p-6">{active ? <><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs uppercase tracking-wider text-[#f3a178]">Script · {active.duration_seconds}s estimated</p>{editing ? <div className="flex gap-2"><button onClick={() => { setEditing(false); setScriptDraft({ outline: active.outline, transcript: active.transcript }); }} disabled={busy} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Cancel</button><button onClick={() => void saveScript()} disabled={busy} className="rounded-lg bg-[#6350c8] px-3 py-2 text-sm">{busy ? 'Saving…' : 'Save edits'}</button></div> : <button onClick={beginEditing} disabled={busy} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Edit outline and script</button>}</div>{editing && scriptDraft ? <div className="mt-4 space-y-5"><label className="block text-sm">Outline title<input value={scriptDraft.outline.title} maxLength={120} onChange={event => updateDraftOutline(current => ({ ...current, title: event.target.value }))} className="mt-1 block w-full rounded-lg bg-[#0e0621] p-2"/></label><label className="block text-sm">Summary<textarea value={scriptDraft.outline.summary} maxLength={600} onChange={event => updateDraftOutline(current => ({ ...current, summary: event.target.value }))} className="mt-1 block min-h-20 w-full rounded-lg bg-[#0e0621] p-2"/></label><h3 className="font-medium">Episode outline</h3>{scriptDraft.outline.segments.map((segment, index) => <fieldset key={index} className="grid gap-2 rounded-lg border border-white/10 p-3"><legend className="px-1 text-sm text-[#f3a178]">Segment {index + 1}</legend><input aria-label={`Segment ${index + 1} title`} value={segment.title} maxLength={120} onChange={event => updateDraftOutline(current => ({ ...current, segments: current.segments.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} className="rounded bg-[#0e0621] p-2"/><textarea aria-label={`Segment ${index + 1} talking points, one per line`} value={segment.talking_points.join('\n')} onChange={event => updateDraftOutline(current => ({ ...current, segments: current.segments.map((item, itemIndex) => itemIndex === index ? { ...item, talking_points: event.target.value.split('\n').slice(0, 4) } : item) }))} className="min-h-20 rounded bg-[#0e0621] p-2"/></fieldset>)}<h3 className="font-medium">Transcript turns</h3>{scriptDraft.transcript.turns.map((line, index) => <fieldset key={index} className="grid gap-2 rounded-lg border border-white/10 p-3"><legend className="px-1 text-sm text-[#f3a178]">Turn {index + 1}</legend><select aria-label={`Turn ${index + 1} speaker`} value={line.speaker} onChange={event => updateDraftTurn(index, current => ({ ...current, speaker: event.target.value as 'host' | 'guest' }))} className="w-fit rounded bg-[#0e0621] p-2"><option value="host">Host</option><option value="guest">Guest</option></select><textarea aria-label={`Turn ${index + 1} text`} value={line.text} maxLength={1500} onChange={event => updateDraftTurn(index, current => ({ ...current, text: event.target.value }))} className="min-h-20 rounded bg-[#0e0621] p-2"/></fieldset>)}</div> : <><h2 className="mt-2 text-2xl font-semibold">{active.title}</h2><p className="mt-2 text-sm text-[#b7adcc]">{active.outline.summary}</p><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">{active.outline.segments.map(segment => <li key={segment.title}><strong>{segment.title}</strong><ul className="list-disc pl-5 text-[#c6b7dd]">{segment.talking_points.map(point => <li key={point}>{point}</li>)}</ul></li>)}</ol>
        <div className="mt-5 flex flex-wrap items-center gap-3"><button onClick={() => selectTurn(turn - 1)} disabled={turn === 0}>Previous</button><span className="text-sm">Turn {turn + 1} / {active.transcript.turns.length}</span><button onClick={() => selectTurn(turn + 1)} disabled={turn + 1 >= active.transcript.turns.length}>Next</button><button onClick={() => void synthesize()} disabled={busy || editing} className="rounded-lg bg-[#6350c8] px-3 py-2">Speak turn</button><button onClick={() => { setQueuePlayback(true); void synthesize(0, true); }} disabled={busy || !piperReady || editing} className="rounded-lg border border-white/20 px-3 py-2">Play episode</button>{queuePlayback && <button onClick={() => { setQueuePlayback(false); audioRef.current?.pause(); }}>Stop</button>}<label className="text-sm">Speed <select value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); if (audioRef.current) audioRef.current.playbackRate = value; }} className="ml-1 rounded bg-[#0e0621] p-1"><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></label></div>
        <div className="mt-5 grid gap-4 rounded-lg border border-white/10 bg-[#0e0621] p-4 sm:grid-cols-2"><div><h3 className="mb-2 text-sm font-medium">Host voice</h3><SpeechVoicePicker health={piperQuery.data} value={active.voice_assignments?.host?.voice || narrationVoice} speaker={active.voice_assignments?.host?.voice ? active.voice_assignments.host.speaker : narrationSpeaker} onChange={(nextVoice, nextSpeaker) => void updateRoleVoice('host', nextVoice, nextSpeaker)} disabled={busy || editing}/><button className="mt-2 text-xs text-[#c6b7dd] underline" disabled={busy || editing || !active.voice_assignments?.host?.voice} onClick={() => void updateRoleVoice('host', '', '')}>Use saved narration voice</button></div><div><h3 className="mb-2 text-sm font-medium">Guest voice</h3><SpeechVoicePicker health={piperQuery.data} value={active.voice_assignments?.guest?.voice || narrationVoice} speaker={active.voice_assignments?.guest?.voice ? active.voice_assignments.guest.speaker : narrationSpeaker} onChange={(nextVoice, nextSpeaker) => void updateRoleVoice('guest', nextVoice, nextSpeaker)} disabled={busy || editing}/><button className="mt-2 text-xs text-[#c6b7dd] underline" disabled={busy || editing || !active.voice_assignments?.guest?.voice} onClick={() => void updateRoleVoice('guest', '', '')}>Use saved narration voice</button></div><p className="text-xs text-[#b7adcc] sm:col-span-2">Unassigned roles use your saved narration voice and speaker.</p></div>
        <p className="mt-4 rounded-lg bg-[#0e0621] p-4"><span className="font-medium text-[#efc778]">{active.transcript.turns[turn]?.speaker === 'host' ? 'Host' : 'Guest'}: </span>{active.transcript.turns[turn]?.text}</p>{audioUrl && <audio ref={audioRef} controls className="mt-3 w-full" src={audioUrl} onEnded={() => { if (queuePlayback && turn + 1 < active.transcript.turns.length) { setTurn(turn + 1); void synthesize(turn + 1, true); } else if (!queuePlayback && turn + 1 < active.transcript.turns.length) selectTurn(turn + 1); else setQueuePlayback(false); }}/>}<p className="mt-2 text-xs text-[#b7adcc]">{piperReady ? 'Piper audio is generated one turn at a time using the configured voice. Audio is not stored as a published episode.' : piperQuery.data?.configured ? 'Piper is disconnected. Read the script here; audio playback is unavailable.' : 'Piper is not configured. Read the script here; audio playback is unavailable.'}</p>
        <details className="mt-5"><summary className="cursor-pointer">Full transcript</summary><div className="mt-3 space-y-3">{active.transcript.turns.map((line, index) => <button key={`${index}-${line.speaker}`} onClick={() => selectTurn(index)} className="block w-full rounded-lg bg-[#0e0621] p-3 text-left text-sm"><strong>{line.speaker === 'host' ? 'Host' : 'Guest'}:</strong> {line.text}</button>)}</div></details></>}
      </> : <p className="text-[#b7adcc]">Choose an episode to read its outline and transcript.</p>}</section></div>
  </div></main>;
}
