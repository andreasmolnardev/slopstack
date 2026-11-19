import { useEffect, useRef, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../api/pocketbase';
import { learningQueryOptions, type VocabularyRecord } from '../api/learning-queries';
import { startWavRecording, type WavRecorder } from '../audio/wav';
import { SpeechVoicePicker } from '../speech-voice-picker';
import { preferencesQueryOptions } from '../api/preferences';

export const Route = createFileRoute('/speaking')({
  beforeLoad: ({ location }) => { if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } }); },
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(learningQueryOptions.vocabulary()),
    context.queryClient.ensureQueryData(learningQueryOptions.piperHealth()),
    context.queryClient.ensureQueryData(preferencesQueryOptions()),
  ]),
  component: SpeakingPractice,
});

function SpeakingPractice() {
  const navigate = useNavigate();
  const vocabularyQuery = useQuery(learningQueryOptions.vocabulary());
  const piperQuery = useQuery(learningQueryOptions.piperHealth());
  const preferencesQuery = useQuery(preferencesQueryOptions());
  const words = (vocabularyQuery.data ?? []).filter(word => word.metadata.language?.trim().toLowerCase() === 'english');
  const [wordId, setWordId] = useState(''); const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const [transcript, setTranscript] = useState(''); const [feedback, setFeedback] = useState('');
  const [voice, setVoice] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [audioUrl, setAudioUrl] = useState(''); const [wavUrl, setWavUrl] = useState('');
  const recorder = useRef<WavRecorder | null>(null); const audioRef = useRef<HTMLAudioElement>(null);
  const recordingTimeout = useRef<number | null>(null);
  const [authUserId, setAuthUserId] = useState(pb.authStore.model?.id);
  const selected = words.find(word => word.id === wordId) ?? words[0];
  const piperReady = Boolean(piperQuery.data?.configured && piperQuery.data.connected);
  useEffect(() => {
    setVoice(preferencesQuery.data?.narrationVoice ?? '');
    setSpeaker(preferencesQuery.data?.narrationSpeaker ?? '');
  }, [preferencesQuery.data?.narrationVoice, preferencesQuery.data?.narrationSpeaker]);
  useEffect(() => () => {
    if (recordingTimeout.current !== null) window.clearTimeout(recordingTimeout.current);
    void recorder.current?.cancel();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (wavUrl) URL.revokeObjectURL(wavUrl);
  }, [audioUrl, wavUrl]);
  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextUserId = model?.id;
    if (authUserId !== nextUserId || !token) {
      setAuthUserId(nextUserId);
      if (recordingTimeout.current !== null) window.clearTimeout(recordingTimeout.current);
      recordingTimeout.current = null;
      void recorder.current?.cancel(); recorder.current = null;
      setRecording(false); setBusy(false); setWordId(''); setTranscript(''); setFeedback('');
      setVoice('');
      setSpeaker('');
      setAudioUrl(previous => { if (previous) URL.revokeObjectURL(previous); return ''; });
      setWavUrl(previous => { if (previous) URL.revokeObjectURL(previous); return ''; });
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/speaking' } });
  }), [authUserId, navigate]);

  async function pronounce() {
    if (!selected) return;
    if (!piperReady) { setNotice(piperQuery.data?.configured ? 'Piper is disconnected.' : 'Piper is not configured.'); return; }
    const ownerId = pb.authStore.model?.id;
    setBusy(true); setNotice('Creating pronunciation…');
    try {
      const response = await fetch(pb.buildUrl('/api/speech/synthesize'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
        body: JSON.stringify({ text: selected.term, voice, speaker }),
      });
      if (!response.ok) throw new Error('Piper could not create the pronunciation');
      const url = URL.createObjectURL(await response.blob());
      if (!pb.authStore.isValid || ownerId !== pb.authStore.model?.id) { URL.revokeObjectURL(url); return; }
      setAudioUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
      setNotice('Pronunciation ready.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create pronunciation'); }
    finally { setBusy(false); }
  }

  async function transcribe(file: Blob) {
    if (file.size > 20 * 1024 * 1024) { setNotice('WAV files must be 20 MB or smaller.'); return; }
    const ownerId = pb.authStore.model?.id;
    setBusy(true); setNotice('Transcribing audio with Whisper…'); setFeedback('');
    try {
      const response = await fetch(pb.buildUrl('/api/speech/transcribe'), {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: pb.authStore.token }, body: file,
      });
      if (!response.ok) { const result = await response.json().catch(() => null) as { message?: string } | null; throw new Error(result?.message ?? 'Whisper transcription failed'); }
      const result = await response.json() as { text: string };
      if (!pb.authStore.isValid || ownerId !== pb.authStore.model?.id) return;
      setTranscript(result.text); setNotice('Transcript ready. Review it, then submit your attempt.');
      const url = URL.createObjectURL(file);
      setWavUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url; });
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Transcription failed'); }
    finally { setBusy(false); }
  }

  async function startRecording() {
    setNotice('Requesting microphone access…');
    try {
      recorder.current = await startWavRecording(); setRecording(true); setNotice('Recording. Speak the word, then stop. Recording stops automatically after 90 seconds.');
      recordingTimeout.current = window.setTimeout(() => { void stopRecording(); }, 90_000);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not start microphone recording'); }
  }

  async function stopRecording() {
    if (!recorder.current) return;
    if (recordingTimeout.current !== null) window.clearTimeout(recordingTimeout.current);
    recordingTimeout.current = null;
    setRecording(false); setBusy(true);
    try { const wav = await recorder.current.stop(); recorder.current = null; await transcribe(wav); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not finish recording'); setBusy(false); }
  }

  async function submit() {
    if (!selected || !transcript.trim()) return;
    const ownerId = pb.authStore.model?.id;
    setBusy(true); setFeedback('');
    try {
      const result = await pb.send<{ correct: boolean; score: number; feedback: string; expected: string }>(`/api/languages/vocabulary/${selected.id}/speaking-attempt`, { method: 'POST', body: { transcript } });
      if (!pb.authStore.isValid || ownerId !== pb.authStore.model?.id) return;
      setFeedback(`${result.feedback} Expected: “${result.expected}”.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not submit attempt'); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]"><div className="mx-auto max-w-3xl">
    <a href="/" className="text-sm text-[#c6b7dd]">← Starburst</a><p className="mt-8 text-sm uppercase tracking-[.2em] text-[#e57fab]">Language practice</p><h1 className="mt-2 text-4xl font-semibold">Speak a saved word</h1>
    <p className="mt-3 text-[#b7adcc]">Listen, record or upload a WAV, review Whisper’s transcript, and check whether it matches your English vocabulary item. This checks transcript text only; it does not grade accent or pronunciation quality.</p>
    <section className="mt-8 rounded-2xl border border-white/10 bg-[#211638] p-6">
      {vocabularyQuery.isLoading ? <p>Loading saved vocabulary…</p> : words.length === 0 ? <p>No English vocabulary items found. Add English words in the Vocabulary practice section first.</p> : <>
        <label className="grid gap-2 text-sm">Choose a word<select value={selected?.id ?? ''} onChange={event => { setWordId(event.target.value); setTranscript(''); setFeedback(''); }} className="rounded-lg bg-[#0e0621] p-3">{words.map((word: VocabularyRecord) => <option key={word.id} value={word.id}>{word.term} — {word.metadata.translation ?? ''}</option>)}</select></label>
        {selected && <><div className="mt-5 rounded-xl bg-[#0e0621] p-5"><p className="text-xs text-[#b7adcc]">{selected.metadata.language} · {selected.metadata.set_name || 'Vocabulary'}</p><h2 className="mt-2 text-3xl font-semibold">{selected.term}</h2><p className="mt-1 text-sm text-[#b7adcc]">Translation: {selected.metadata.translation}</p></div>
          <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy || !piperReady} onClick={() => void pronounce()} className="rounded-lg bg-[#6350c8] px-4 py-2">Test voice and play pronunciation</button>{!recording ? <button disabled={busy} onClick={() => void startRecording()} className="rounded-lg border border-white/20 px-4 py-2">Record attempt</button> : <button onClick={() => void stopRecording()} className="rounded-lg bg-[#aa65c9] px-4 py-2">Stop and transcribe</button>}</div>
          <div className="mt-4"><SpeechVoicePicker health={piperQuery.data} value={voice} speaker={speaker} onChange={(nextVoice, nextSpeaker) => { setVoice(nextVoice); setSpeaker(nextSpeaker); }} disabled={busy}/></div>
          <p className="mt-2 text-xs text-[#b7adcc]">{piperReady ? 'Piper is ready.' : piperQuery.data?.configured ? 'Piper is disconnected.' : 'Piper is not configured.'} Microphone access needs a secure browser context. English transcript matching is supported in this first version.</p>
          {audioUrl && <audio ref={audioRef} controls autoPlay src={audioUrl} className="mt-3 w-full"/>}
          <label className="mt-6 block text-sm">Or upload a WAV recording<input className="mt-2 block w-full text-xs" type="file" accept="audio/wav,.wav" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void transcribe(file); }}/></label>
          {wavUrl && <audio controls src={wavUrl} className="mt-3 w-full"/>}
          {transcript && <><label className="mt-5 grid gap-2 text-sm">Whisper transcript (you may correct transcription errors)<textarea value={transcript} onChange={event => setTranscript(event.target.value)} maxLength={2000} className="min-h-24 rounded-lg bg-[#0e0621] p-3"/></label><button disabled={busy || !transcript.trim()} onClick={() => void submit()} className="mt-3 rounded-lg bg-[#aa65c9] px-4 py-2">Check spoken attempt</button></>}
        </>}
      </>}
      {notice && <p role="status" className="mt-4 text-sm text-[#efc778]">{notice}</p>}{feedback && <p role="status" className="mt-3 rounded-lg bg-[#0e0621] p-4 text-sm">{feedback}</p>}
    </section>
  </div></main>;
}
