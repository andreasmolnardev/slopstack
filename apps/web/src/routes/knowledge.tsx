import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { learningQueryOptions } from '../api/learning-queries';
import type { LearningRecord } from '../api/learning-queries';
import { pb } from '../api/pocketbase';
import { filterKnowledgeUnits, layoutKnowledgeGraph } from '../knowledge-explorer';

export const Route = createFileRoute('/knowledge')({
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(learningQueryOptions.knowledgeUnits()),
    context.queryClient.ensureQueryData(learningQueryOptions.edges()),
    context.queryClient.ensureQueryData(learningQueryOptions.dueReviews()),
  ]),
  component: KnowledgeExplorer,
});

function KnowledgeExplorer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [authUserId, setAuthUserId] = useState(pb.authStore.model?.id);
  const unitsQuery = useQuery(learningQueryOptions.knowledgeUnits());
  const edgesQuery = useQuery(learningQueryOptions.edges());
  const dueQuery = useQuery(learningQueryOptions.dueReviews());
  const sourcesQuery = useQuery(learningQueryOptions.sources());
  const [search, setSearch] = useState('');
  const [unitType, setUnitType] = useState('all');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [editMessage, setEditMessage] = useState('');
  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextUserId = model?.id;
    if (nextUserId !== authUserId || !token) {
      setAuthUserId(nextUserId);
      setSelectedId('');
      queryClient.clear();
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/knowledge' } });
  }), [authUserId, navigate, queryClient]);
  const units = unitsQuery.data ?? [];
  const filtered = useMemo(() => filterKnowledgeUnits(units, search, unitType), [units, search, unitType]);
  const graphPoints = useMemo(() => layoutKnowledgeGraph(filtered.slice(0, 60)), [filtered]);
  const selectedIdValue = filtered.some((unit) => unit.id === selectedId) ? selectedId : filtered[0]?.id ?? '';
  const selectedQuery = useQuery({ ...learningQueryOptions.knowledgeUnit(selectedIdValue), enabled: Boolean(selectedIdValue) });
  const evidenceQuery = useQuery({ ...learningQueryOptions.knowledgeEvidence(selectedIdValue), enabled: Boolean(selectedIdValue) });
  const selected = selectedQuery.data ?? units.find((unit) => unit.id === selectedIdValue);
  useEffect(() => {
    setEditing(false);
    setEditMessage('');
    setDraftTitle(selected?.title ?? '');
    setDraftDescription(selected?.description ?? '');
  }, [selected?.id, selected?.title, selected?.description]);
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const edges = (edgesQuery.data ?? []).filter((edge) => edge.from_unit === selectedIdValue || edge.to_unit === selectedIdValue);
  const dueById = new Map((dueQuery.data ?? []).map((item) => [item.unit.id, item]));
  const sourceById = new Map((sourcesQuery.data ?? []).map((source) => [source.id, source]));
  const unitTypes = [...new Set(units.map((unit) => unit.unit_type).filter((value): value is string => Boolean(value)))].sort();

  async function saveSelected() {
    if (!selected || !draftTitle.trim()) return;
    setEditMessage('');
    try {
      const updated = await pb.send<typeof selected>(`/api/learning/knowledge-units/${selected.id}`, {
        method: 'PATCH',
        body: { title: draftTitle.trim(), description: draftDescription.trim(), unit_type: selected.unit_type, metadata: selected.metadata ?? {} },
      });
      queryClient.setQueryData(learningQueryOptions.knowledgeUnit(selected.id).queryKey, updated);
      await queryClient.invalidateQueries({ queryKey: learningQueryOptions.knowledgeUnits().queryKey });
      setEditing(false);
      setEditMessage('Knowledge item saved.');
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : 'Could not save this knowledge item.');
    }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm(`Delete “${selected.title}” and its learning history?`)) return;
    try {
      await pb.send(`/api/learning/knowledge-units/${selected.id}`, { method: 'DELETE' });
      queryClient.removeQueries({ queryKey: learningQueryOptions.knowledgeUnit(selected.id).queryKey });
      queryClient.removeQueries({ queryKey: learningQueryOptions.knowledgeEvidence(selected.id).queryKey });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.knowledgeUnits().queryKey }),
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.edges().queryKey }),
        queryClient.invalidateQueries({ queryKey: learningQueryOptions.dueReviews().queryKey }),
      ]);
      setSelectedId('');
      setEditMessage('Knowledge item and its learning history deleted.');
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : 'Could not delete this knowledge item.');
    }
  }

  return <main className="min-h-screen bg-[#0e0621] px-6 py-8 text-[#f8f5fc]">
    <div className="mx-auto max-w-6xl">
      <Link to="/" className="text-sm text-[#c6b7dd]">← Learning space</Link>
      <header className="mt-8">
        <p className="text-sm uppercase tracking-[.2em] text-[#e57fab]">Knowledge map</p>
        <h1 className="mt-2 text-4xl font-semibold">Explore what you know</h1>
        <p className="mt-3 max-w-2xl text-[#b7adcc]">Search concepts, vocabulary, and grammar, then inspect their descriptions and typed relationships.</p>
        <Link to="/sources" className="mt-3 inline-block text-sm text-[#e57fab]">Manage imported source notes →</Link>
      </header>

      {unitsQuery.error && <p role="alert" className="mt-6 text-rose-200">Could not load your knowledge library.</p>}
      <div className="mt-8 grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
        <section className="rounded-2xl border border-white/10 bg-[#211638] p-5">
          <h2 className="text-lg font-semibold">Your knowledge</h2>
          <label className="mt-4 block text-sm">Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title or description" className="mt-2 w-full rounded-lg bg-[#0e0621] p-3"/></label>
          <label className="mt-3 block text-sm">Type<select value={unitType} onChange={(event) => setUnitType(event.target.value)} className="mt-2 w-full rounded-lg bg-[#0e0621] p-3"><option value="all">All types</option>{unitTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
          <div className="mt-4 flex gap-2" role="group" aria-label="Knowledge view"><button aria-pressed={view === 'list'} onClick={() => setView('list')} className={`rounded-lg px-3 py-2 text-sm ${view === 'list' ? 'bg-[#6350c8]' : 'border border-white/15'}`}>List</button><button aria-pressed={view === 'map'} onClick={() => setView('map')} className={`rounded-lg px-3 py-2 text-sm ${view === 'map' ? 'bg-[#6350c8]' : 'border border-white/15'}`}>Map</button></div>
          <p className="mt-4 text-xs text-[#b7adcc]">{filtered.length} of {units.length} items · {edgesQuery.data?.length ?? 0} relationships</p>
          {filtered.length === 0 ? <p className="mt-5 rounded-lg border border-dashed border-white/15 p-5 text-sm text-[#b7adcc]">No knowledge items match this search.</p> : view === 'map' ? <KnowledgeGraph points={graphPoints} edges={edgesQuery.data ?? []} selectedId={selectedIdValue} dueIds={new Set(dueById.keys())} onSelect={setSelectedId} /> : <ul className="mt-3 max-h-[32rem] divide-y divide-white/10 overflow-y-auto">{filtered.map((unit) => {
            const due = dueById.get(unit.id);
            return <li key={unit.id}><button aria-current={unit.id === selectedIdValue ? 'true' : undefined} onClick={() => setSelectedId(unit.id)} className={`w-full rounded-lg px-3 py-3 text-left ${unit.id === selectedIdValue ? 'bg-[#0e0621]' : 'hover:bg-white/5'}`}><span className="flex items-center justify-between gap-3"><span className="font-medium">{unit.title}</span>{due && <span className="rounded-full bg-[#aa65c9]/20 px-2 py-1 text-[10px] text-[#efc778]">Review due</span>}</span><span className="mt-1 block text-xs capitalize text-[#b7adcc]">{unit.unit_type?.replaceAll('_', ' ') ?? 'knowledge'}</span></button></li>;
          })}</ul>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#211638] p-6">
          {selected ? <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-[#f3a178]">{selected.unit_type?.replaceAll('_', ' ') ?? 'Knowledge'}</p><h2 className="mt-2 text-2xl font-semibold">{selected.title}</h2></div><div className="flex flex-wrap items-center gap-2">{dueById.has(selected.id) && <span className="rounded-full border border-[#efc778]/30 px-3 py-1 text-sm text-[#efc778]">Due for review · mastery {Math.round((dueById.get(selected.id)?.mastery ?? 0) * 100)}%</span>}<button onClick={() => { setEditing((value) => !value); setEditMessage(''); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm">{editing ? 'Close editor' : 'Edit'}</button><button onClick={() => void deleteSelected()} className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-sm text-rose-200">Delete</button></div></div>
            {editing && <form onSubmit={(event) => { event.preventDefault(); void saveSelected(); }} className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-[#0e0621] p-4"><label className="grid gap-1 text-sm">Title<input required maxLength={200} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="rounded-lg bg-[#211638] p-2"/></label><label className="grid gap-1 text-sm">Definition, examples, and notes<textarea maxLength={10000} value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} className="min-h-36 rounded-lg bg-[#211638] p-3"/></label><button className="w-fit rounded-lg bg-[#6350c8] px-4 py-2">Save knowledge item</button></form>}
            {editMessage && <p role="status" className="mt-3 text-sm text-[#efc778]">{editMessage}</p>}
            {selectedQuery.isFetching && <p className="mt-3 text-xs text-[#b7adcc]">Refreshing details…</p>}
            <p className="mt-5 whitespace-pre-wrap leading-7 text-[#d4cde2]">{selected.description || 'No description saved for this knowledge item yet.'}</p>
            {Array.isArray(selected.metadata?.source_ids) && selected.metadata.source_ids.length > 0 && <section className="mt-5"><h3 className="text-sm font-medium">Sources</h3><ul className="mt-2 space-y-1 text-sm text-[#b7adcc]">{selected.metadata.source_ids.map((id) => typeof id === 'string' ? <li key={id}>{sourceById.get(id)?.title ?? 'Linked source'}</li> : null)}</ul></section>}
            {typeof selected.metadata?.course_id === 'string' && <Link to="/courses/$courseId" params={{ courseId: selected.metadata.course_id }} className="mt-4 inline-block text-sm text-[#e57fab]">Open related course →</Link>}
            <h3 className="mt-8 text-lg font-semibold">Relationships</h3>
            {edges.length === 0 ? <p className="mt-2 text-sm text-[#b7adcc]">No relationships saved for this item.</p> : <ul className="mt-3 space-y-2">{edges.map((edge) => {
              const otherId = edge.from_unit === selected.id ? edge.to_unit : edge.from_unit;
              const other = unitMap.get(otherId ?? '');
              return <li key={edge.id} className="rounded-lg bg-[#0e0621] p-3 text-sm"><span className="text-[#efc778]">{edge.relationship?.replaceAll('_', ' ') ?? 'related to'}</span><span className="mx-2 text-[#b7adcc]">{edge.from_unit === selected.id ? '→' : '←'}</span>{other?.title ?? 'Linked knowledge item'}</li>;
            })}</ul>}
            <h3 className="mt-8 text-lg font-semibold">Learning evidence</h3>
            {evidenceQuery.isLoading ? <p className="mt-2 text-sm text-[#b7adcc]">Loading evidence…</p> : evidenceQuery.error ? <p role="alert" className="mt-2 text-sm text-rose-200">Could not load evidence history.</p> : evidenceQuery.data?.length ? <ol className="mt-3 space-y-2">{[...evidenceQuery.data].reverse().map((item) => <li key={item.id} className="rounded-lg bg-[#0e0621] p-3 text-sm"><div className="flex justify-between gap-3"><span className="capitalize">{item.evidence_type.replaceAll('_', ' ')}</span><span className="text-[#efc778]">{Math.round(item.score * 100)}%</span></div>{item.details && <p className="mt-1 text-xs text-[#b7adcc]">{JSON.stringify(item.details)}</p>}</li>)}</ol> : <p className="mt-2 text-sm text-[#b7adcc]">No learning attempts recorded yet.</p>}
            <div className="mt-8 rounded-xl border border-white/10 p-4"><h3 className="font-medium">Review</h3><p className="mt-1 text-sm text-[#b7adcc]">{dueById.has(selected.id) ? 'This concept is in your spaced review queue.' : 'No review is due for this concept right now.'}</p><Link to="/" className="mt-3 inline-block text-sm text-[#e57fab]">Open today’s review queue →</Link><Link to="/practice" className="mt-2 block text-sm text-[#e57fab]">Start a knowledge quiz →</Link></div>
          </> : <p className="text-[#b7adcc]">Select a knowledge item to inspect its details.</p>}
        </section>
      </div>
    </div>
  </main>;
}

function KnowledgeGraph({points,edges,selectedId,dueIds,onSelect}:{points:ReturnType<typeof layoutKnowledgeGraph>;edges:LearningRecord[];selectedId:string;dueIds:Set<string>;onSelect:(id:string)=>void}) {
  const byId = new Map(points.map((point) => [point.id, point]));
  const visibleEdges = edges.filter((edge) => byId.has(edge.from_unit ?? '') && byId.has(edge.to_unit ?? ''));
  const colors = ['#e57fab', '#f3a178', '#efc778', '#8fc6d8', '#aa9ce6', '#b7d38b'];
  const types = [...new Set(points.map((point) => point.type))];
  const colorFor = (type: string) => colors[types.indexOf(type) % colors.length];
  return <div className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#0e0621] p-2">
    <svg viewBox="0 0 800 520" role="group" aria-label="Interactive knowledge map grouped by knowledge type" className="min-w-[620px] w-full">
      <defs><marker id="knowledge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#81779a"/></marker></defs>
      {visibleEdges.map((edge) => {
        const from = byId.get(edge.from_unit ?? '')!;
        const to = byId.get(edge.to_unit ?? '')!;
        return <g key={edge.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#81779a" strokeOpacity=".6" strokeWidth="2" markerEnd="url(#knowledge-arrow)"/><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} fill="#d4cde2" fontSize="10" textAnchor="middle">{edge.relationship?.replaceAll('_', ' ') ?? 'related'}</text></g>;
      })}
      {points.map((point) => <g key={point.id} role="button" tabIndex={0} aria-label={`${point.title}, ${point.type}${dueIds.has(point.id) ? ', review due' : ''}`} aria-pressed={selectedId === point.id} onClick={() => onSelect(point.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.id); } }} className="cursor-pointer">
        <circle cx={point.x} cy={point.y} r={selectedId === point.id ? 27 : 23} fill="#211638" stroke={dueIds.has(point.id) ? '#efc778' : colorFor(point.type)} strokeWidth={selectedId === point.id ? 4 : 2}/>
        <text x={point.x} y={point.y + 4} fill="#f8f5fc" fontSize="10" textAnchor="middle">{point.title.length > 15 ? `${point.title.slice(0, 14)}…` : point.title}</text>
        {dueIds.has(point.id) && <circle cx={point.x + 19} cy={point.y - 18} r="5" fill="#efc778"/>}
      </g>)}
      {types.map((type,index) => <g key={type} transform={`translate(18 ${22 + index * 20})`}><circle r="5" fill={colorFor(type)}/><text x="10" y="4" fill="#b7adcc" fontSize="11">{type.replaceAll('_', ' ')}</text></g>)}
    </svg>
    <p className="px-3 pb-2 text-xs text-[#b7adcc]">Select a node to inspect its details. Gold rings mark concepts due for review. Map view shows up to 60 filtered items.</p>
  </div>;
}
