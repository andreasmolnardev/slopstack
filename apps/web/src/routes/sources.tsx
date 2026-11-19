import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { learningQueryOptions, type LearningSource } from '../api/learning-queries';
import { pb } from '../api/pocketbase';

export const Route = createFileRoute('/sources')({
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(learningQueryOptions.sources()),
  component: SourceLibrary,
});

type EditableSource = LearningSource & { content?: string };

function SourceLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery(learningQueryOptions.sources());
  const sources = (sourcesQuery.data ?? []) as EditableSource[];
  const [ownerID, setOwnerID] = useState(pb.authStore.model?.id ?? '');
  const [search, setSearch] = useState('');
  const [selectedID, setSelectedID] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceType, setSourceType] = useState<'text/plain' | 'text/markdown'>('text/markdown');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => sources.filter((source) => `${source.title} ${source.source_type}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [sources, search]);
  const selectedIDValue = filtered.some((source) => source.id === selectedID) ? selectedID : filtered[0]?.id ?? '';
  const selectedQuery = useQuery({ ...learningQueryOptions.source(selectedIDValue), enabled: Boolean(selectedIDValue) });
  const selected = (selectedQuery.data ?? filtered.find((source) => source.id === selectedIDValue)) as EditableSource | undefined;

  useEffect(() => {
    setSelectedID(selected?.id ?? '');
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
    setSourceType(selected?.source_type === 'text/plain' ? 'text/plain' : 'text/markdown');
    setMessage('');
  }, [selected?.id, selected?.title, selected?.content, selected?.source_type]);

  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextOwnerID = model?.id ?? '';
    if (nextOwnerID !== ownerID || !token) {
      setOwnerID(nextOwnerID);
      setSelectedID('');
      setTitle('');
      setContent('');
      setMessage('');
      queryClient.clear();
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/sources' } });
  }), [navigate, ownerID, queryClient]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !title.trim() || !content.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await pb.send(`/api/learning/sources/${selected.id}`, { method: 'PATCH', body: { title, content, source_type: sourceType } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.sources().queryKey }),
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.source(selected.id).queryKey }),
      ]);
      setMessage('Source updated. Future course generation will use the revised text.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update this source.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete “${selected.title}” and its source-derived learning records?`)) return;
    setBusy(true);
    setMessage('');
    try {
      await pb.send(`/api/learning/sources/${selected.id}`, { method: 'DELETE' });
      setSelectedID('');
      queryClient.removeQueries({ queryKey: learningQueryOptions.source(selected.id).queryKey });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.sources().queryKey }),
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.knowledgeUnits().queryKey }),
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.edges().queryKey }),
      ]);
      setMessage('Source and its source-derived learning records deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this source.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]">
    <div className="mx-auto max-w-6xl">
      <Link to="/knowledge" className="text-sm text-[#c6b7dd]">← Knowledge map</Link>
      <header className="mt-8"><p className="text-sm uppercase tracking-[.2em] text-[#e57fab]">Source library</p><h1 className="mt-2 text-4xl font-semibold">Manage your learning material</h1><p className="mt-3 max-w-2xl text-[#b7adcc]">Correct titles and source text before using it in future course generation. Edits do not rewrite previous courses or concepts you have customized separately.</p></header>
      {sourcesQuery.error && <p role="alert" className="mt-6 text-rose-200">Could not load your sources.</p>}
      <div className="mt-8 grid gap-6 lg:grid-cols-[.75fr_1.25fr]">
        <section className="rounded-2xl border border-white/10 bg-[#211638] p-5">
          <h2 className="text-lg font-semibold">Imported material</h2>
          <label className="mt-4 block text-sm">Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-2 w-full rounded-lg bg-[#0e0621] p-3" placeholder="Source title or format"/></label>
          {sourcesQuery.isLoading ? <p className="mt-5 text-sm text-[#b7adcc]">Loading sources…</p> : filtered.length === 0 ? <p className="mt-5 rounded-lg border border-dashed border-white/15 p-5 text-sm text-[#b7adcc]">{sources.length ? 'No sources match your search.' : 'No imported sources yet. Add notes from the learning dashboard.'}</p> : <ul className="mt-4 max-h-[34rem] divide-y divide-white/10 overflow-y-auto">{filtered.map((source) => <li key={source.id}><button aria-current={source.id === selectedIDValue ? 'true' : undefined} onClick={() => setSelectedID(source.id)} className={`w-full rounded-lg px-3 py-3 text-left ${source.id === selectedIDValue ? 'bg-[#0e0621]' : 'hover:bg-white/5'}`}><span className="block font-medium">{source.title}</span><span className="mt-1 block text-xs text-[#b7adcc]">{source.source_type === 'text/markdown' ? 'Markdown' : 'Plain text'}</span></button></li>)}</ul>}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#211638] p-6">
          {selected ? <form onSubmit={save} className="grid gap-4">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-[#f3a178]">Edit source</p><h2 className="mt-1 text-2xl font-semibold">{selected.title}</h2></div><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg border border-rose-300/30 px-3 py-2 text-sm text-rose-200">Delete</button></div>
            <label className="grid gap-2 text-sm">Title<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-lg bg-[#0e0621] p-3"/></label>
            <label className="grid gap-2 text-sm">Format<select value={sourceType} onChange={(event) => setSourceType(event.target.value as 'text/plain' | 'text/markdown')} className="w-fit rounded-lg bg-[#0e0621] p-3"><option value="text/markdown">Markdown</option><option value="text/plain">Plain text</option></select></label>
            <label className="grid gap-2 text-sm">Source text<textarea required maxLength={1024 * 1024} value={content} onChange={(event) => setContent(event.target.value)} className="min-h-[28rem] rounded-lg bg-[#0e0621] p-3 font-mono text-sm leading-6"/></label>
            <div className="flex flex-wrap items-center gap-3"><button disabled={busy || !title.trim() || !content.trim()} className="rounded-lg bg-[#6350c8] px-5 py-2.5">{busy ? 'Saving…' : 'Save source'}</button><span className="text-xs text-[#b7adcc]">Maximum source size: 1 MiB</span></div>
            {message && <p role="status" className="text-sm text-[#efc778]">{message}</p>}
          </form> : <p className="text-[#b7adcc]">Select a source to edit it.</p>}
        </section>
      </div>
    </div>
  </main>;
}
