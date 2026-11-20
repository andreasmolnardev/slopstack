import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { checkpointBlocksProgress, flattenCourseScenes, sceneAtTimelinePosition, sceneCaptionText, sceneDurationSeconds, timelineDurationWithSegments, timelinePosition, triangleMetrics } from './learning-timeline';
import type { LessonPlayerMode } from './learning-timeline';
import type { WidgetConfig } from './learning-timeline';
import { BinarySearchVisualizer, ClassificationExercise, LogicGateExplorer, ProbabilitySimulation, StateMachineVisualizer, VectorExplorer } from './learning-widgets';
import type { WidgetInteractionState } from './learning-interactions';
import { initialAssessmentAnswers, moveOrderedAnswer, updateMatchAnswer } from './learning-assessment';
import type { AssessmentQuestion } from './learning-assessment';
import { pb } from './api/pocketbase';
import { learningQueryOptions } from './api/learning-queries';
import type { GrammarRecord, LearningRecord, LearningSource, PiperHealth } from './api/learning-queries';
import { SpeechVoicePicker } from './speech-voice-picker';
import { preferencesQueryOptions } from './api/preferences';
import { getCourseProgress, getLearningJob } from './api/generated/sdk.gen';
import { client as generatedClient } from './api/generated/client.gen';
import { offlineLearningStore, persistProgressOfflineFirst } from './api/offline-learning';
import { saveCourseProgressOnline } from './api/offline-progress';
import { LessonAssistant } from './lesson-assistant';
import { fetchLessonNarration } from './lesson-narration';
import { readWidgetInteraction, writeWidgetInteraction } from './learning-interactions';

export function Starburst({ initialCourse, redirectTo, offlineMode = false, onOfflineExit }: { initialCourse?: LearningRecord; redirectTo?: string; offlineMode?: boolean; onOfflineExit?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggedIn, setLoggedIn] = useState(pb.authStore.isValid);
  const authUserId = useRef(pb.authStore.model?.id);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const coursesQuery = useQuery({
    ...learningQueryOptions.courses(),
    enabled: loggedIn && !offlineMode,
  });
  const unitsQuery = useQuery({
    ...learningQueryOptions.knowledgeUnits(),
    enabled: loggedIn && !offlineMode,
  });
  const sourcesQuery = useQuery({ ...learningQueryOptions.sources(), enabled: loggedIn && !offlineMode });
  const profileQuery = useQuery({ ...preferencesQueryOptions(), enabled: loggedIn && !offlineMode });
  const piperQuery = useQuery({ ...learningQueryOptions.piperHealth(), enabled: loggedIn && !offlineMode });
  const courses = coursesQuery.data ?? [];
  const units = unitsQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [generationSourceIds, setGenerationSourceIds] = useState<string[]>([]);
  const [generationConceptIds, setGenerationConceptIds] = useState<string[]>([]);
  const [generationDifficulty, setGenerationDifficulty] = useState<'' | 'beginner' | 'intermediate' | 'advanced'>('');
  const [targetMinutes, setTargetMinutes] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeCourse, setActiveCourse] = useState<LearningRecord | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [sceneSeconds, setSceneSeconds] = useState(0);
  const [assessment, setAssessment] = useState(false);
  const [generationJob, setGenerationJob] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);

  useEffect(() => pb.authStore.onChange((token, model) => {
    const nextUserId = model?.id;
    if (authUserId.current !== nextUserId) {
      authUserId.current = nextUserId;
      queryClient.clear();
      setGenerationSourceIds([]);
      setGenerationConceptIds([]);
      setGenerationDifficulty('');
      setTargetMinutes(0);
      setTitle('');
      setGoal('');
      setActiveCourse(null);
      setGenerationJob(null);
      setAssessment(false);
    }
    setLoggedIn(Boolean(token && model));
  }), [queryClient]);

  async function load() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['learning', 'courses'] }),
      queryClient.invalidateQueries({ queryKey: ['learning', 'knowledge-units'] }),
    ]);
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await pb.collection('users').authWithPassword(email, password); setLoggedIn(true); await navigate({ href: redirectTo ?? '/' }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }
  async function createCourse(event: React.FormEvent) {
    event.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError('');
    try {
      await pb.send('/api/learning/courses', { method: 'POST', body: { title: title.trim(), description: goal.trim(), content: { version: 1, modules: [], generation: 'not_started' } } });
      setTitle(''); setGoal(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create course'); }
    finally { setBusy(false); }
  }
  async function createConcept(event: React.FormEvent) {
    event.preventDefault(); if (!goal.trim()) return;
    setBusy(true); setError('');
    try {
      await pb.send('/api/learning/knowledge-units', { method: 'POST', body: { title: goal.trim(), unit_type: 'concept', metadata: {} } });
      setGoal(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save concept'); }
    finally { setBusy(false); }
  }
  async function generateCourse(course: LearningRecord) {
    setBusy(true); setError('');
    try {
      const job = await pb.send<{id:string}>(`/api/learning/courses/${course.id}/generate`, { method: 'POST', body: { source_ids: generationSourceIds, concept_ids: generationConceptIds, ...(generationDifficulty ? { difficulty: generationDifficulty } : {}), ...(targetMinutes ? { target_minutes: targetMinutes } : {}) } });
      setGenerationJob(job.id); setGenerationProgress(0);
      let state='queued';
      while(state==='queued'||state==='running') {
        await new Promise(resolve=>window.setTimeout(resolve,1000));
        const response=await getLearningJob({client:generatedClient,path:{id:job.id}});
        if(response.error||!response.data)throw new Error('Could not check course generation status');
        const status=response.data as {status:string;error?:string;progress?:number};state=status.status;setGenerationProgress(status.progress??0);
        if(state==='failed')throw new Error(status.error||'Course generation failed');
        if(state==='cancelled')throw new Error('Course generation was cancelled');
      }
      const updated=await queryClient.fetchQuery(learningQueryOptions.course(course.id));
      queryClient.setQueryData<LearningRecord[]>(learningQueryOptions.courses().queryKey, items => items?.map(item => item.id === updated.id ? updated : item)); queryClient.setQueryData(learningQueryOptions.course(updated.id).queryKey, updated); setSceneIndex(0); setAssessment(false); await navigate({to:'/courses/$courseId',params:{courseId:updated.id}});
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create lessons'); }
    finally { setBusy(false); setGenerationJob(null); setGenerationProgress(0); }
  }
  async function cancelGeneration(){if(generationJob)await pb.send(`/api/learning/jobs/${generationJob}/cancel`,{method:'POST',body:{}});}
  async function deleteCourse(course:LearningRecord){if(!window.confirm(`Delete “${course.title}” and its course content?`))return;try{await pb.send(`/api/learning/courses/${course.id}`,{method:'DELETE'});queryClient.setQueryData<LearningRecord[]>(learningQueryOptions.courses().queryKey, items=>items?.filter(item=>item.id!==course.id));queryClient.removeQueries({queryKey:learningQueryOptions.course(course.id).queryKey})}catch(e){setError(e instanceof Error?e.message:'Could not delete course')}}
  async function openCourse(course: LearningRecord) {
    setBusy(true); setError('');
    try {
      if (offlineMode || !navigator.onLine) {
        const ownerId = pb.authStore.model?.id;
        if (!ownerId) throw new Error('Sign in to read downloaded lessons');
        const progress = await offlineLearningStore.getSavedProgress(ownerId, course.id);
        setActiveCourse(course); setSceneIndex(progress?.sceneIndex ?? 0); setSceneSeconds(progress?.positionSeconds ?? 0); setAssessment(offlineMode ? false : progress?.completed ?? false);
        return;
      }
      const result = await getCourseProgress({path:{id:course.id}});
      if(result.error||!result.data)throw new Error('Could not load course progress');
      setActiveCourse(course); setSceneIndex(result.data.scene_index || 0); setSceneSeconds(result.data.position_seconds || 0); setAssessment(result.data.completed);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not resume course'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (initialCourse && loggedIn) void openCourse(initialCourse);
  }, [initialCourse?.id, loggedIn]);
  async function submitAssessment(answers:Record<string,unknown>) {
    if(!activeCourse) throw new Error('No active course');
    return pb.send<AssessmentResult>(`/api/learning/courses/${activeCourse.id}/assess`,{method:'POST',body:{answers}});
  }

  if (!loggedIn) return <main className="min-h-screen bg-[#0e0621] px-6 py-16 text-[#f8f5fc]"><div className="mx-auto max-w-md"><Brand/><section className="mt-12 rounded-2xl border border-white/10 bg-[#211638] p-7"><h1 className="text-2xl font-semibold">Welcome back</h1><p className="mt-2 text-[#b7adcc]">Sign in to continue learning.</p><form className="mt-6 grid gap-4" onSubmit={signIn}><input className="rounded-lg border border-white/15 bg-[#0e0621] p-3" type="email" required placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input className="rounded-lg border border-white/15 bg-[#0e0621] p-3" type="password" required placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy} className="rounded-lg bg-[#6350c8] p-3 font-medium">Sign in</button></form>{error&&<p role="alert" className="mt-4 text-rose-300">{error}</p>}</section></div></main>;

  const exitCourse = () => offlineMode ? onOfflineExit?.() : void navigate({to:'/'});
  if (activeCourse && assessment) return <Assessment course={activeCourse} onSubmit={submitAssessment} onExit={exitCourse} offlineMode={offlineMode} piperReady={Boolean(piperQuery.data?.configured && piperQuery.data.connected)} narrationVoice={profileQuery.data?.narrationVoice ?? ''} narrationSpeaker={profileQuery.data?.narrationSpeaker ?? ''}/>;
  if (activeCourse) return <Lesson course={activeCourse} initialSceneIndex={sceneIndex} initialPositionSeconds={sceneSeconds} captionsByDefault={profileQuery.data?.captions ?? true} narrationByDefault={profileQuery.data?.narration ?? true} narrationVoiceByDefault={profileQuery.data?.narrationVoice ?? ''} narrationSpeakerByDefault={profileQuery.data?.narrationSpeaker ?? ''} piperHealth={piperQuery.data} offlineMode={offlineMode} onComplete={()=>offlineMode?onOfflineExit?.():setAssessment(true)} onExit={exitCourse}/>;
  return <main className="min-h-screen bg-[#0e0621] text-[#f8f5fc]"><header className="border-b border-white/10"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"><Brand/><nav className="flex items-center gap-5 text-sm text-[#b7adcc]"><a href="#courses">Courses</a><a href="#knowledge">Knowledge</a><Link to="/knowledge">Knowledge map</Link><Link to="/practice">Adaptive practice</Link><Link to="/sources">Sources</Link><Link to="/offline">Offline library</Link><Link to="/audio">Audio Studio</Link><Link to="/speaking">Speaking practice</Link><Link to="/profile">Learner profile</Link><button onClick={()=>{pb.authStore.clear();setLoggedIn(false);void navigate({to:'/login',search:{redirect:'/'}})}}>Sign out</button></nav></div></header><div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1.4fr_.8fr]"><section><p className="text-sm uppercase tracking-[.2em] text-[#e57fab]">Your learning universe</p><h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">Turn curiosity into understanding.</h1><p className="mt-3 max-w-xl text-[#b7adcc]">Build a learning path, explore ideas, and grow a knowledge base that follows you between courses.</p><section id="courses" className="mt-10"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Your courses</h2>{generationJob&&<><span role="status" aria-live="polite" className="text-sm text-[#efc778]">Building course: {generationProgress}%</span><button onClick={()=>void cancelGeneration()} className="text-sm text-rose-300">Cancel generation</button></>}<span className="text-sm text-[#b7adcc]">{courses.length} courses</span></div>{coursesQuery.isLoading||unitsQuery.isLoading?<p className="rounded-xl border border-dashed border-white/15 p-8 text-[#b7adcc]">Loading your learning space…</p>:coursesQuery.error||unitsQuery.error?<p role="alert" className="rounded-xl border border-rose-300/30 p-5 text-rose-200">Could not load your learning data. {coursesQuery.error instanceof Error?coursesQuery.error.message:unitsQuery.error instanceof Error?unitsQuery.error.message:''}</p>:courses.length===0?<p className="rounded-xl border border-dashed border-white/15 p-8 text-[#b7adcc]">Your first course starts with a question.</p>:<div className="grid gap-3 sm:grid-cols-2">{courses.map(c=><article key={c.id} className="rounded-xl border border-white/10 bg-[#211638] p-5"><p className="text-xs uppercase tracking-wider text-[#f3a178]">{c.status||'draft'}</p><h3 className="mt-2 text-lg font-medium">{c.title}</h3><p className="mt-2 text-sm text-[#b7adcc]">{c.description||'Learning course'}</p><div className="mt-4 flex gap-2"><button disabled={busy} onClick={()=>courseHasModules(c)?void navigate({to:'/courses/$courseId',params:{courseId:c.id}}):void generateCourse(c)} className="rounded-lg bg-[#6350c8] px-4 py-2">{courseHasModules(c)?'Continue learning':'Build lesson'}</button><button onClick={()=>void deleteCourse(c)} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Delete</button></div></article>)}</div>}<CoursePortability courses={courses} onImported={()=>void load()} onArchiveImported={()=>void load()}/><CourseVersionHistory courses={courses} onRestored={updated=>{queryClient.setQueryData<LearningRecord[]>(learningQueryOptions.courses().queryKey,items=>items?.map(item=>item.id===updated.id?updated:item));queryClient.setQueryData(learningQueryOptions.course(updated.id).queryKey,updated)}}/><div className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-[#211638] p-5"><h3 className="font-medium">Ground your next lesson</h3><p className="text-sm text-[#b7adcc]">Choose personal notes and concepts for the next course you build.</p><label className="grid gap-2 text-sm">Sources (up to 4)<select multiple size={Math.min(4,Math.max(2,sources.length))} value={generationSourceIds} onChange={e=>setGenerationSourceIds(Array.from(e.currentTarget.selectedOptions,option=>option.value).slice(0,4))} className="rounded-lg border border-white/10 bg-[#0e0621] p-3">{sources.map(source=><option key={source.id} value={source.id}>{source.title}</option>)}</select></label><label className="grid gap-2 text-sm">Concepts (up to 8)<select multiple size={Math.min(5,Math.max(2,units.length))} value={generationConceptIds} onChange={e=>setGenerationConceptIds(Array.from(e.currentTarget.selectedOptions,option=>option.value).slice(0,8))} className="rounded-lg border border-white/10 bg-[#0e0621] p-3">{units.map(unit=><option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label><label className="grid gap-2 text-sm">Difficulty<select value={generationDifficulty} onChange={e=>setGenerationDifficulty(e.target.value as ''|'beginner'|'intermediate'|'advanced')} className="rounded-lg border border-white/10 bg-[#0e0621] p-3"><option value="">Use profile default{profileQuery.data ? ` (${profileQuery.data.defaultDifficulty})` : ""}</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><label className="grid gap-2 text-sm">Target lesson length (5–60 minutes)<input type="number" min={5} max={60} value={targetMinutes || ''} placeholder={profileQuery.data ? `Profile default: ${profileQuery.data.targetMinutes} min` : 'Use profile default'} onChange={e=>setTargetMinutes(e.target.value === '' ? 0 : Number(e.target.value))} className="w-48 rounded-lg border border-white/10 bg-[#0e0621] p-3"/></label></div><form onSubmit={createCourse} className="mt-4 grid gap-3 rounded-xl bg-[#211638] p-5"><h3 className="font-medium">Create a course</h3><input className="rounded-lg border border-white/10 bg-[#0e0621] p-3" placeholder="What do you want to learn?" value={title} onChange={e=>setTitle(e.target.value)} required/><input className="rounded-lg border border-white/10 bg-[#0e0621] p-3" placeholder="Your goal (optional)" value={goal} onChange={e=>setGoal(e.target.value)}/><button disabled={busy} className="w-fit rounded-lg bg-[#6350c8] px-5 py-2.5">Save learning goal</button></form><ReviewQueue units={units}/></section></section><aside id="knowledge" className="rounded-2xl border border-white/10 bg-[#211638] p-6"><h2 className="text-xl font-semibold">Knowledge library</h2><p className="mt-2 text-sm text-[#b7adcc]">Concepts you collect become part of your personal learning map.</p><form onSubmit={createConcept} className="mt-5 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0e0621] p-3" placeholder="Add a concept" value={goal} onChange={e=>setGoal(e.target.value)}/><button disabled={busy} className="rounded-lg bg-[#aa65c9] px-4">Add</button></form><ul className="mt-5 divide-y divide-white/10">{units.map(u=><li key={u.id} className="py-3"><span className="text-sm">{u.title}</span><span className="ml-2 text-xs text-[#b7adcc]">{u.unit_type}</span></li>)}</ul><VocabularyPanel/><GrammarPanel/><SourceImporter onImported={()=>void load()}/><SpeechPanel/><KnowledgeEdges units={units}/>{error&&<p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}</aside></div></main>;
}

function KnowledgeEdges({units}:{units:LearningRecord[]}) {
  const queryClient=useQueryClient();const edgesQuery=useQuery(learningQueryOptions.edges());const edges=edgesQuery.data??[];const [from,setFrom]=useState('');const [to,setTo]=useState('');const [kind,setKind]=useState('related_to');
  async function add(event:React.FormEvent){event.preventDefault();await pb.send('/api/learning/edges',{method:'POST',body:{from_unit:from,to_unit:to,relationship:kind}});await queryClient.invalidateQueries({queryKey:['learning','edges']})}
  return <section className="mt-6 border-t border-white/10 pt-5"><h3 className="font-medium">Concept connections</h3><form onSubmit={add} className="mt-3 grid gap-2"><select aria-label="From concept" className="rounded-lg bg-[#0e0621] p-2" value={from} onChange={e=>setFrom(e.target.value)} required><option value="">Choose concept</option>{units.map(u=><option key={u.id} value={u.id}>{u.title}</option>)}</select><select aria-label="Relationship type" className="rounded-lg bg-[#0e0621] p-2" value={kind} onChange={e=>setKind(e.target.value)}>{['related_to','requires','builds_on','part_of','applies_to','contrasts_with','example_of','commonly_confused_with'].map(v=><option key={v}>{v}</option>)}</select><select aria-label="To concept" className="rounded-lg bg-[#0e0621] p-2" value={to} onChange={e=>setTo(e.target.value)} required><option value="">Choose related concept</option>{units.filter(u=>u.id!==from).map(u=><option key={u.id} value={u.id}>{u.title}</option>)}</select><button disabled={!from||!to} className="rounded-lg bg-[#6350c8] p-2">Connect concepts</button></form><ul className="mt-3 text-sm text-[#b7adcc]">{edges.map(e=><li key={e.id} className="py-1">{units.find(u=>u.id===e.from_unit)?.title} {e.relationship?.replaceAll('_',' ')} {units.find(u=>u.id===e.to_unit)?.title}</li>)}</ul></section>
}

function ReviewQueue({units}:{units:LearningRecord[]}) {
  const queryClient=useQueryClient();const dueQuery=useQuery(learningQueryOptions.dueReviews());const due=dueQuery.data??[];const [message,setMessage]=useState('');
  async function answer(unit:string,quality:number){const result=await pb.send<{interval_days:number}>(`/api/learning/reviews/${unit}`,{method:'POST',body:{quality}});setMessage(`Next review in ${result.interval_days} day(s).`);await queryClient.invalidateQueries({queryKey:['learning','reviews','due']})}
  if(!units.length)return null;
  return <section className="mt-8 rounded-xl border border-white/10 bg-[#211638] p-5"><h2 className="text-lg font-semibold">Spaced review</h2><p className="mt-1 text-sm text-[#b7adcc]">Review a concept and rate how well you recalled it.</p>{due.length===0?<p className="mt-4 text-sm text-[#b7adcc]">Nothing due right now.</p>:due.map(item=><div key={item.unit.id} className="mt-4 rounded-lg bg-[#0e0621] p-4"><p>{item.unit.title}</p><p className="mt-1 text-xs text-[#b7adcc]">Current mastery: {Math.round(item.mastery*100)}%</p><div className="mt-3 flex flex-wrap gap-2">{[['Again',1],['Hard',3],['Good',4],['Easy',5]].map(([label,value])=><button key={label} onClick={()=>void answer(item.unit.id,Number(value))} className="rounded-md bg-[#6350c8] px-3 py-1.5 text-sm">{label}</button>)}</div></div>)}{message&&<p role="status" className="mt-3 text-sm text-[#efc778]">{message}</p>}</section>
}

function Lesson({course,initialSceneIndex,initialPositionSeconds,captionsByDefault,narrationByDefault,narrationVoiceByDefault,narrationSpeakerByDefault,piperHealth,offlineMode,onComplete,onExit}:{course:LearningRecord;initialSceneIndex:number;initialPositionSeconds:number;captionsByDefault:boolean;narrationByDefault:boolean;narrationVoiceByDefault:string;narrationSpeakerByDefault:string;piperHealth?:PiperHealth;offlineMode:boolean;onComplete:()=>void;onExit:()=>void}) {
  const scenes = flattenCourseScenes(course.content);
  const [sceneIndex,setSceneIndex]=useState(Math.max(0,Math.min(scenes.length-1,initialSceneIndex)));
  const [elapsed,setElapsed]=useState(Math.max(0,initialPositionSeconds));
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(1);
  const [volume,setVolume]=useState(0.85);
  const [captionsEnabled,setCaptionsEnabled]=useState(captionsByDefault);
  const [narrationEnabled,setNarrationEnabled]=useState(narrationByDefault);
  const [narrationVoice,setNarrationVoice]=useState(narrationVoiceByDefault);
  const [narrationSpeaker,setNarrationSpeaker]=useState(narrationSpeakerByDefault);
  useEffect(()=>{setNarrationVoice(narrationVoiceByDefault);setNarrationSpeaker(narrationSpeakerByDefault)},[course.id,narrationVoiceByDefault,narrationSpeakerByDefault]);
  const [playbackMode,setPlaybackMode]=useState<LessonPlayerMode>('interactive');
  const [checkpointOpen,setCheckpointOpen]=useState(false);
  const [checkpointAnswer,setCheckpointAnswer]=useState(()=>readWidgetInteraction(pb.authStore.model?.id??'offline',course.id,course.version??1,scenes[Math.max(0,Math.min(scenes.length-1,initialSceneIndex))]?.id??String(initialSceneIndex)).reflection??'');
  const [checkpointFeedback,setCheckpointFeedback]=useState('');
  const [checkpointBusy,setCheckpointBusy]=useState(false);
  const [progressQueued,setProgressQueued]=useState(false);
  const [narrationUrls,setNarrationUrls]=useState<string[]>([]);
  const [narrationDurations,setNarrationDurations]=useState<number[]>([]);
  const [narrationBusy,setNarrationBusy]=useState(false);
  const [narrationMessage,setNarrationMessage]=useState('');
  const [widgetRevision,setWidgetRevision]=useState(0);
  const [isFullscreen,setIsFullscreen]=useState(false);
  const elapsedRef=useRef(elapsed); const audioRef=useRef<HTMLAudioElement>(null); const finishingRef=useRef(false); const playerRef=useRef<HTMLElement>(null);
  const narrationAbortRef=useRef<AbortController|null>(null);
  const scene=scenes[sceneIndex];
  const config=scene?.widget?.config ?? {};
  useEffect(()=>{const owner=pb.authStore.model?.id??'offline';setCheckpointAnswer(readWidgetInteraction(owner,course.id,course.version??1,scene?.id??String(sceneIndex)).reflection??'')},[course.id,course.version,sceneIndex,scene?.id]);
  const caption=sceneCaptionText(scene,elapsed);
  const duration=scene?(narrationDurations[sceneIndex]??sceneDurationSeconds(scene)):0;
  const totalDuration=timelineDurationWithSegments(scenes,narrationDurations);
  const position=timelinePosition(scenes,sceneIndex,elapsed,narrationDurations);
  const checkpointRequired=Boolean(scene?.checkpoints?.some(item=>item.required));
  const narrationReady=narrationUrls.length===scenes.length&&scenes.length>0;
  const narrationPlaying=narrationReady&&playbackMode!=='silent';

  useEffect(()=>{ elapsedRef.current=elapsed; },[elapsed]);
  useEffect(()=>{setCaptionsEnabled(captionsByDefault)},[captionsByDefault]);
  useEffect(()=>{setNarrationEnabled(narrationByDefault)},[narrationByDefault]);
  useEffect(()=>{
    if(!offlineMode)return;
    const ownerId=pb.authStore.model?.id;
    if(!ownerId)return;
    let active=true;
    void offlineLearningStore.getNarrationAssets(ownerId,course.id,course.version??1).then(async blobs=>{
      if(!active)return;
      if(!blobs||blobs.length!==scenes.length){setNarrationMessage('Narration is not saved for this offline lesson. Download it while online.');return}
      const urls=blobs.map(blob=>URL.createObjectURL(blob));
      try{
        const durations=await Promise.all(urls.map(readAudioDuration));
        if(active){setNarrationUrls(urls);setNarrationDurations(durations);setNarrationEnabled(true);setNarrationMessage('Saved narration ready offline');}
        else urls.forEach(URL.revokeObjectURL);
      }catch{urls.forEach(URL.revokeObjectURL);if(active)setNarrationMessage('Saved narration could not be opened in this browser.');}
    }).catch(()=>{if(active)setNarrationMessage('Could not load saved narration.');});
    return()=>{active=false;};
  },[offlineMode,course.id,course.version,scenes.length]);
  useEffect(()=>{
    const save=()=>{void persistProgress(sceneIndex,elapsedRef.current).catch(error=>setCheckpointFeedback(error instanceof Error?error.message:'Could not save course progress'));};
    const timer=window.setInterval(save,10000); return ()=>window.clearInterval(timer);
  },[course.id,sceneIndex]);
  useEffect(()=>()=>{narrationUrls.forEach(url=>URL.revokeObjectURL(url))},[narrationUrls]);
  useEffect(()=>()=>narrationAbortRef.current?.abort(),[]);
  useEffect(()=>{
    const sync=()=>setIsFullscreen(document.fullscreenElement===playerRef.current);
    document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);
  },[]);
  useEffect(()=>{
    if(playbackMode==='explore'||playbackMode==='silent'){
      setPlaying(false);
      audioRef.current?.pause();
    }
    if(playbackMode==='silent')setCaptionsEnabled(true);
  },[playbackMode]);
  useEffect(()=>{
    const audio=audioRef.current;if(!audio||!narrationReady)return;
    audio.playbackRate=speed;audio.volume=volume;
    if(Math.abs(audio.currentTime-elapsed)>0.25)audio.currentTime=Math.min(elapsed,duration);
  },[sceneIndex,narrationReady,speed,volume]);

  async function persistProgress(index:number,seconds:number,completed=false){
    const ownerId=pb.authStore.model?.id;
    if(!ownerId)throw new Error('Sign in to save course progress');
    const result=await persistProgressOfflineFirst({ownerId,courseId:course.id,sceneIndex:index,positionSeconds:seconds,completed,updatedAt:Date.now()},offlineLearningStore,saveCourseProgressOnline);
    setProgressQueued(result.queued);
  }
  async function advanceScene(){
    if(!scene)return;
    if(checkpointBlocksProgress(playbackMode,checkpointRequired,checkpointAnswer)){setCheckpointOpen(true);setPlaying(false);audioRef.current?.pause();setCheckpointFeedback('Complete this reflection before continuing.');return}
    const reflectionSubmitted=checkpointRequired&&Boolean(checkpointAnswer.trim());
    try { if(!offlineMode&&navigator.onLine)await pb.send(`/api/learning/courses/${course.id}/evidence`,{method:'POST',body:{unit:scene.id||`scene-${sceneIndex+1}`,evidence_type:reflectionSubmitted?'interaction_checkpoint':'scene_completed',score:1,details:reflectionSubmitted?{response:checkpointAnswer.trim()}:{}}}); }
    catch(e){setPlaying(false);audioRef.current?.pause();setCheckpointFeedback(e instanceof Error?e.message:'Could not save learning progress');return}
    setCheckpointOpen(false);setCheckpointFeedback('');finishingRef.current=false;
    if(sceneIndex+1<scenes.length){setSceneIndex(sceneIndex+1);setElapsed(0);elapsedRef.current=0;await persistProgress(sceneIndex+1,0);}
    else {setPlaying(false);await persistProgress(sceneIndex,duration,true);audioRef.current?.pause();onComplete();}
  }
  useEffect(()=>{
    if(!playing||!scene||narrationPlaying)return;
    const timer=window.setInterval(()=>{
      setElapsed(previous=>{
        const next=Math.min(duration,previous+0.1*speed);elapsedRef.current=next;
        if(next>=duration&&!finishingRef.current){finishingRef.current=true;window.setTimeout(()=>void advanceScene(),0)}
        return next;
      });
    },100);
    return ()=>window.clearInterval(timer);
  },[playing,sceneIndex,duration,speed,narrationPlaying,checkpointRequired,checkpointAnswer,playbackMode]);
  useEffect(()=>{
    if(playing&&narrationPlaying)audioRef.current?.play().catch(()=>setPlaying(false));
  },[playing,sceneIndex,narrationPlaying]);

  async function togglePlayback(){
    if(playbackMode==='explore')return;
    if(playing){setPlaying(false);audioRef.current?.pause();void persistProgress(sceneIndex,elapsedRef.current).catch(error=>setCheckpointFeedback(error instanceof Error?error.message:'Could not save course progress'));return}
    if(narrationEnabled&&!narrationReady&&!offlineMode&&playbackMode!=='silent')await prepareNarratedTimeline();
    finishingRef.current=false;setPlaying(true);
    if(narrationPlaying&&audioRef.current){audioRef.current.currentTime=elapsedRef.current;audioRef.current.playbackRate=speed;audioRef.current.play().catch(()=>setPlaying(false));}
  }
  function onAudioTimeUpdate(){const time=audioRef.current?.currentTime;if(typeof time==='number'){elapsedRef.current=time;setElapsed(time)}}
  async function seekTo(target:number){
    const mapped=sceneAtTimelinePosition(scenes,target,narrationDurations);setPlaying(false);finishingRef.current=false;setWidgetRevision(value=>value+1);setSceneIndex(mapped.sceneIndex);setElapsed(mapped.sceneSeconds);elapsedRef.current=mapped.sceneSeconds;
    if(audioRef.current){audioRef.current.pause();if(mapped.sceneIndex===sceneIndex)audioRef.current.currentTime=mapped.sceneSeconds;}
    try{await persistProgress(mapped.sceneIndex,mapped.sceneSeconds)}catch(e){setCheckpointFeedback(e instanceof Error?e.message:'Could not save course position')}
  }
  async function prepareNarratedTimeline(saveOffline=false):Promise<boolean>{
    if(!scene||narrationBusy)return false;
    setNarrationBusy(true);setNarrationMessage(`Preparing narration 0/${scenes.length}…`);setCheckpointFeedback('');
    const urls:string[]=[];const durations:number[]=[];const blobs:Blob[]=[];let cached=0;
    const controller=new AbortController();narrationAbortRef.current=controller;
    try{
      for(let index=0;index<scenes.length;index+=1){
        const narration=await fetchLessonNarration({url:pb.buildUrl(`/api/learning/courses/${course.id}/narration`),token:pb.authStore.token,scene:scenes[index],sceneIndex:index,voice:narrationVoice,speaker:narrationSpeaker,signal:controller.signal});
        if(narration.cacheHit)cached+=1;
        const blob=narration.blob;const url=URL.createObjectURL(blob);
        try{durations.push(await readAudioDuration(url));urls.push(url);blobs.push(blob)}catch(error){URL.revokeObjectURL(url);throw error}
        setNarrationMessage(`Preparing narration ${index+1}/${scenes.length}…`);
      }
      if(saveOffline){
        const ownerId=pb.authStore.model?.id;
        if(!ownerId)throw new Error('Sign in to save narration offline');
        await offlineLearningStore.saveNarrationAssets(ownerId,course.id,course.version??1,blobs);
      }
      setNarrationUrls(urls);setNarrationDurations(durations);setElapsed(Math.min(elapsedRef.current,durations[sceneIndex]??0));
      setNarrationMessage(`${saveOffline?'Narration saved for offline use · ':''}Narrated timeline ready${cached?` · ${cached}/${scenes.length} reused`:''} · ${formatTime(durations.reduce((total,value)=>total+value,0))}`);
      return true;
    }catch(e){urls.forEach(url=>URL.revokeObjectURL(url));setNarrationMessage('');if(!controller.signal.aborted)setCheckpointFeedback(e instanceof Error?e.message:'Could not prepare narrated timeline');return false}
    finally{if(narrationAbortRef.current===controller)narrationAbortRef.current=null;setNarrationBusy(false)}
  }
  async function saveCurrentNarrationOffline(){
    if(!narrationReady){await prepareNarratedTimeline(true);return;}
    const ownerId=pb.authStore.model?.id;
    if(!ownerId){setNarrationMessage('Sign in to save narration offline');return;}
    setNarrationBusy(true);setNarrationMessage('Saving narration for offline use…');
    try{
      const blobs=await Promise.all(narrationUrls.map(async url=>{const response=await fetch(url);return response.blob();}));
      await offlineLearningStore.saveNarrationAssets(ownerId,course.id,course.version??1,blobs);
      setNarrationMessage('Narration saved for offline use');
    }catch(error){setNarrationMessage(error instanceof Error?error.message:'Could not save narration offline');}
    finally{setNarrationBusy(false);}
  }
  function removeNarration(){setPlaying(false);audioRef.current?.pause();setNarrationUrls([]);setNarrationDurations([]);setNarrationMessage('Narration turned off');}
  function cancelNarration(){narrationAbortRef.current?.abort()}
  async function toggleFullscreen(){
    try{if(document.fullscreenElement)await document.exitFullscreen();else await playerRef.current?.requestFullscreen();}
    catch(e){setCheckpointFeedback(e instanceof Error?e.message:'Fullscreen is unavailable in this browser')}
  }
  useEffect(()=>{
    function onKey(event:KeyboardEvent){
      if(event.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target.tagName))return;
      if(event.code==='Space'){event.preventDefault();void togglePlayback()}
      else if(event.code==='ArrowRight'){event.preventDefault();void seekTo(Math.min(totalDuration,position+5))}
      else if(event.code==='ArrowLeft'){event.preventDefault();void seekTo(Math.max(0,position-5))}
      else if(event.key.toLowerCase()==='r'){event.preventDefault();void seekTo(0)}
      else if(event.key.toLowerCase()==='f'){event.preventDefault();void toggleFullscreen()}
    }
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[position,totalDuration,playing,speed,sceneIndex,narrationPlaying,isFullscreen,playbackMode]);

  async function submitCheckpoint(event:React.FormEvent){event.preventDefault();if(!checkpointAnswer.trim())return;setCheckpointBusy(true);try{await advanceScene()}finally{setCheckpointBusy(false)}}
  if(!scene)return <main className="min-h-screen bg-[#0e0621] p-10 text-white"><h1>Lesson complete</h1><button onClick={onExit}>Back to courses</button></main>;
  return <main ref={playerRef} className="min-h-screen bg-[#0e0621] px-5 py-6 text-[#f8f5fc] fullscreen:overflow-auto fullscreen:px-8 fullscreen:py-5 md:px-8"><div className="mx-auto max-w-5xl">
    <div className="flex items-center justify-between"><button onClick={onExit} className="text-sm text-[#b7adcc]">← Course library</button><button onClick={()=>void toggleFullscreen()} aria-label={isFullscreen?'Exit fullscreen':'Enter fullscreen'} className="rounded-lg border border-white/15 px-3 py-2 text-sm">{isFullscreen?'Exit fullscreen':'Fullscreen'}</button></div>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#e57fab]">{course.title} · Scene {sceneIndex+1} of {scenes.length}{offlineMode?' · Offline':''}</p><h1 className="mt-1 text-2xl font-semibold">{scene.title}</h1>{progressQueued&&<p role="status" className="mt-1 text-xs text-[#efc778]">Progress saved on this device and will sync when online.</p>}</div><div className="flex flex-wrap items-center gap-2">{offlineMode?<span className="text-xs text-[#b7adcc]">{narrationReady?'Saved narration available offline':'No narration downloaded'}</span>:narrationBusy?<button onClick={cancelNarration} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Cancel narration</button>:<><button aria-pressed={narrationEnabled} onClick={()=>{if(narrationEnabled){setNarrationEnabled(false);removeNarration()}else{setNarrationEnabled(true);if(!narrationReady)void prepareNarratedTimeline()}}} className="rounded-lg border border-white/15 px-3 py-2 text-sm">{narrationEnabled?'Narration on':'Turn narration on'}</button><button onClick={()=>void saveCurrentNarrationOffline()} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Save narration offline</button></>}{narrationMessage&&<span role="status" className="text-xs text-[#b7adcc]">{narrationMessage}</span>}</div></div>
    {!offlineMode&&narrationEnabled&&<div className="mt-3"><SpeechVoicePicker health={piperHealth} value={narrationVoice} speaker={narrationSpeaker} onChange={(voice,speaker)=>{setNarrationVoice(voice);setNarrationSpeaker(speaker);removeNarration()}} disabled={narrationBusy}/></div>}
    <div className="mt-5"><label htmlFor="lesson-timeline" className="sr-only">Lesson timeline</label><input id="lesson-timeline" type="range" min={0} max={totalDuration} step={0.1} value={Math.min(totalDuration,position)} onChange={event=>void seekTo(Number(event.target.value))} className="w-full accent-[#e57fab]" aria-label="Seek lesson timeline"/><div className="flex justify-between text-xs text-[#b7adcc]"><span>{formatTime(position)}</span><span>{formatTime(totalDuration)}</span></div><div className="mt-2 flex gap-1" aria-label="Scene timeline">{scenes.map((item,index)=><button key={item.id||index} onClick={()=>void seekTo(timelinePosition(scenes,index,0,narrationDurations))} aria-label={`Seek to scene ${index+1}: ${item.title||'Scene'}`} className={`h-1.5 flex-1 rounded ${index===sceneIndex?'bg-[#e57fab]':index<sceneIndex?'bg-[#aa65c9]':'bg-white/15'}`}/>)}</div></div>
    <section className="mt-6 rounded-2xl border border-white/10 bg-[#211638] p-6 md:p-10"><WidgetStage key={`${scene.id||sceneIndex}:${widgetRevision}`} type={scene.widget?.type??'explanation'} config={config} initialState={readWidgetInteraction(pb.authStore.model?.id??'offline',course.id,course.version??1,scene.id??String(sceneIndex))} onStateChange={state=>{const owner=pb.authStore.model?.id??'offline';const sceneKey=scene.id??String(sceneIndex);writeWidgetInteraction(owner,course.id,course.version??1,sceneKey,{...readWidgetInteraction(owner,course.id,course.version??1,sceneKey),...state});}}/>
      {captionsEnabled&&<div className="mt-8 rounded-xl border border-white/10 bg-[#0e0621] p-4" aria-live="polite"><p className="text-xs uppercase tracking-wider text-[#e57fab]">Caption · {formatTime(elapsed)} / {formatTime(duration)}</p><p className="mt-1 leading-relaxed">{caption}</p></div>}
      {narrationReady&&<audio ref={audioRef} src={narrationUrls[sceneIndex]} preload="auto" onTimeUpdate={onAudioTimeUpdate} onEnded={()=>{finishingRef.current=true;void advanceScene()}} onError={()=>setCheckpointFeedback('Narration could not be decoded by this browser.')} aria-label={`Synchronized narration for ${scene.title}`}/>}
      {checkpointOpen&&<form onSubmit={submitCheckpoint} className="mt-5 rounded-xl border border-[#efc778]/40 bg-[#0e0621] p-4"><label className="block text-sm font-medium" htmlFor="scene-reflection">Pause and reflect: {String(config.question||'Explain the idea in your own words.')}</label><textarea id="scene-reflection" className="mt-3 min-h-24 w-full rounded-lg border border-white/10 bg-[#211638] p-3" value={checkpointAnswer} onChange={event=>{const answer=event.target.value;setCheckpointAnswer(answer);const owner=pb.authStore.model?.id??'offline';const sceneKey=scene.id??String(sceneIndex);writeWidgetInteraction(owner,course.id,course.version??1,sceneKey,{...readWidgetInteraction(owner,course.id,course.version??1,sceneKey),reflection:answer});}} required/><button disabled={checkpointBusy||!checkpointAnswer.trim()} className="mt-3 rounded-lg bg-[#6350c8] px-4 py-2">{checkpointBusy?'Saving…':'Save reflection and continue'}</button></form>}
      {checkpointFeedback&&<p role="status" className="mt-3 text-sm text-[#efc778]">{checkpointFeedback}</p>}
      <LessonAssistant key={`${course.id}:${sceneIndex}`} courseId={course.id} sceneIndex={sceneIndex} disabled={offlineMode}/>
    </section>
    <div className="mt-4 flex flex-wrap items-center gap-2"><button disabled={playbackMode==='explore'} aria-label={playing?'Pause lesson':'Play lesson'} onClick={togglePlayback} className="rounded-lg bg-[#6350c8] px-4 py-2">{playing?'Pause':'Play'}</button><button aria-label="Restart lesson" onClick={()=>void seekTo(0)} className="rounded-lg border border-white/15 px-3 py-2">Restart</button><button onClick={()=>void seekTo(Math.max(0,position-5))} className="rounded-lg border border-white/15 px-3 py-2">−5 sec</button><button onClick={()=>void seekTo(Math.min(totalDuration,position+5))} className="rounded-lg border border-white/15 px-3 py-2">+5 sec</button><label className="text-sm text-[#b7adcc]">Mode <select aria-label="Lesson player mode" value={playbackMode} onChange={event=>setPlaybackMode(event.target.value as LessonPlayerMode)} className="ml-2 rounded bg-[#211638] p-2 text-white"><option value="watch">Watch</option><option value="interactive">Interactive</option><option value="explore">Explore</option><option value="silent">Silent</option></select></label><button aria-pressed={captionsEnabled} onClick={()=>setCaptionsEnabled(value=>!value)} className="rounded-lg border border-white/15 px-3 py-2">Captions {captionsEnabled?'on':'off'}</button>{narrationReady&&<label className="text-sm text-[#b7adcc]">Volume <input aria-label="Narration volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={event=>setVolume(Number(event.target.value))} className="ml-2 align-middle accent-[#e57fab]"/></label>}<label className="ml-auto text-sm text-[#b7adcc]">Speed <select aria-label="Playback speed" className="ml-2 rounded bg-[#211638] p-2 text-white" value={speed} onChange={event=>{const value=Number(event.target.value);setSpeed(value);if(audioRef.current)audioRef.current.playbackRate=value}}>{[0.5,0.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value}×</option>)}</select></label></div>
    <p className="mt-2 text-xs text-[#b7adcc]">Keyboard: Space play/pause · ←/→ seek 5 seconds · R restart · F fullscreen. Interactive mode pauses for required reflections; Explore pauses the timeline; Silent keeps captions visible.</p>
  </div></main>;
}

function readAudioDuration(url:string):Promise<number>{
  return new Promise((resolve,reject)=>{
    const audio=new Audio();audio.preload='metadata';
    const finish=(duration?:number)=>{window.clearTimeout(timeout);audio.onloadedmetadata=null;audio.onerror=null;audio.removeAttribute('src');audio.load();if(duration)resolve(duration);else reject(new Error('Narration audio duration could not be read'))};
    const timeout=window.setTimeout(()=>finish(),15000);
    audio.onloadedmetadata=()=>Number.isFinite(audio.duration)&&audio.duration>0?finish(audio.duration):finish();
    audio.onerror=()=>finish();audio.src=url;audio.load();
  });
}

function formatTime(seconds:number){const value=Math.max(0,Math.floor(seconds));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}

function courseHasModules(course: LearningRecord): boolean {
  return Array.isArray(course.content?.modules) && course.content.modules.length > 0;
}


type AssessmentResult={score:number;points_earned:number;points_possible:number;feedback:string;results:Array<{question_id:string;correct:boolean;points_earned:number;points_possible:number;feedback:string}>};
function courseAssessmentQuestions(course:LearningRecord):AssessmentQuestion[]{
  const modules: unknown[] = Array.isArray(course.content?.modules) ? course.content.modules : [];
  return modules.flatMap((raw): AssessmentQuestion[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const assessment = (raw as { assessment?: unknown }).assessment;
    if (typeof assessment !== 'object' || assessment === null) return [];
    const questions = (assessment as { questions?: unknown }).questions;
    return Array.isArray(questions) ? questions as AssessmentQuestion[] : [];
  });
}
function Assessment({course,onSubmit,onExit,offlineMode,piperReady,narrationVoice,narrationSpeaker}:{course:LearningRecord;onSubmit:(answers:Record<string,unknown>)=>Promise<AssessmentResult>;onExit:()=>void;offlineMode:boolean;piperReady:boolean;narrationVoice:string;narrationSpeaker:string}) {
  const questions=courseAssessmentQuestions(course);const [answers,setAnswers]=useState<Record<string,unknown>>(()=>initialAssessmentAnswers(questions));const [result,setResult]=useState<AssessmentResult|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [audioUrls,setAudioUrls]=useState<Record<string,string>>({});const [audioNotice,setAudioNotice]=useState('');const [audioBusy,setAudioBusy]=useState('');const audioUrlRef=useRef<Record<string,string>>({});
  useEffect(()=>()=>Object.values(audioUrlRef.current).forEach(URL.revokeObjectURL),[]);
  async function playListening(question:AssessmentQuestion){
    if(offlineMode){
      if(!('speechSynthesis' in window)){setAudioNotice('This browser has no offline speech voice available.');return}
      window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(question.audio_text||''));setAudioNotice('Playing with an installed browser voice.');return;
    }
    const saved=audioUrlRef.current[question.id];if(saved){const player=document.getElementById(`assessment-audio-${question.id}`) as HTMLAudioElement|null;if(player)void player.play();return}
    if(!piperReady){setAudioNotice('Piper is not connected. This listening question cannot play right now.');return}
    setAudioBusy(question.id);setAudioNotice('Preparing the listening prompt…');
    try{const response=await fetch(pb.buildUrl('/api/speech/synthesize'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:pb.authStore.token},body:JSON.stringify({text:question.audio_text,voice:narrationVoice,speaker:narrationSpeaker})});if(!response.ok)throw new Error('Piper could not synthesize this prompt');const url=URL.createObjectURL(await response.blob());audioUrlRef.current[question.id]=url;setAudioUrls(current=>({...current,[question.id]:url}));setAudioNotice('Listening prompt ready.')}catch(error){setAudioNotice(error instanceof Error?error.message:'Could not prepare the listening prompt')}finally{setAudioBusy('')}
  }
  function setAnswer(id:string,value:unknown){setAnswers(current=>({...current,[id]:value}))}
  function toggleMultiple(id:string,choice:string){const current=Array.isArray(answers[id])?answers[id] as string[]:[];setAnswer(id,current.includes(choice)?current.filter(value=>value!==choice):[...current,choice])}
  async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{setResult(await onSubmit(answers))}catch(e){setError(e instanceof Error?e.message:'Could not submit assessment')}finally{setBusy(false)}}
  const results=new Map((result?.results??[]).map(item=>[item.question_id,item]));
  return <main className="min-h-screen bg-[#0e0621] px-6 py-10 text-[#f8f5fc]"><div className="mx-auto max-w-3xl"><button onClick={onExit} className="text-sm text-[#b7adcc]">← Course library</button><section className="mt-8 rounded-2xl border border-white/10 bg-[#211638] p-6 md:p-10"><p className="text-sm uppercase tracking-widest text-[#e57fab]">Course assessment</p><h1 className="mt-2 text-3xl font-semibold">Show what you understand about {course.title}</h1><p className="mt-3 text-sm text-[#b7adcc]">Questions check the learning objectives from your course. Answers are scored against their answer keys.</p>
    {!questions.length?<div className="mt-6 rounded-lg bg-[#0e0621] p-4"><p>This course has no generated assessment questions.</p><button onClick={onExit} className="mt-3 rounded bg-[#6350c8] px-4 py-2">Return to courses</button></div>:<form onSubmit={submit} className="mt-6 space-y-5">{questions.map((question,index)=>{const itemResult=results.get(question.id);const selected=answers[question.id];const matches=typeof selected==='object'&&selected!==null&&!Array.isArray(selected)?selected as Record<string,string>:{};const ordered=Array.isArray(selected)?selected as string[]:question.items||[];function moveItem(from:number,to:number){setAnswer(question.id,moveOrderedAnswer(ordered,from,to))}return <fieldset key={question.id} className="rounded-xl border border-white/10 bg-[#0e0621] p-4"><legend className="px-2 text-lg font-medium">{index+1}. {question.prompt}</legend><p className="mt-1 text-xs text-[#b7adcc]">Objective: {question.objective} · {question.points||1} point(s)</p>
      {question.type==='multiple_choice'&&<div className="mt-3 grid gap-2">{(question.choices||[]).map(choice=><label key={choice} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3"><input type="radio" name={question.id} checked={selected===choice} onChange={()=>setAnswer(question.id,choice)}/><span>{choice}</span></label>)}</div>}
      {question.type==='listening'&&<><div className="mt-3 rounded-lg border border-white/10 p-3"><p className="text-sm text-[#b7adcc]">Listen to the spoken prompt, then choose the answer.</p><button type="button" disabled={audioBusy===question.id} onClick={()=>void playListening(question)} className="mt-2 rounded bg-[#6350c8] px-3 py-2">{audioBusy===question.id?'Preparing…':'Listen to prompt'}</button>{audioUrls[question.id]&&<audio id={`assessment-audio-${question.id}`} controls className="mt-3 w-full" src={audioUrls[question.id]}/>}</div><div className="mt-3 grid gap-2">{(question.choices||[]).map(choice=><label key={choice} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3"><input type="radio" name={question.id} checked={selected===choice} onChange={()=>setAnswer(question.id,choice)}/><span>{choice}</span></label>)}</div></>}
      {question.type==='multiple_select'&&<div className="mt-3 grid gap-2">{(question.choices||[]).map(choice=><label key={choice} className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3"><input type="checkbox" checked={Array.isArray(selected)&&selected.includes(choice)} onChange={()=>toggleMultiple(question.id,choice)}/><span>{choice}</span></label>)}</div>}
      {question.type==='true_false'&&<div className="mt-3 flex gap-3">{[true,false].map(value=><button key={String(value)} type="button" aria-pressed={selected===value} onClick={()=>setAnswer(question.id,value)} className={`rounded-lg border px-4 py-2 ${selected===value?'border-[#e57fab] bg-[#211638]':'border-white/15'}`}>{value?'True':'False'}</button>)}</div>}
      {question.type==='numeric'&&<input aria-label={`Answer to question ${index+1}`} type="number" step="any" value={typeof selected==='string'||typeof selected==='number'?selected:''} onChange={event=>setAnswer(question.id,event.target.value)} className="mt-3 w-full rounded-lg bg-[#211638] p-3"/>}
      {(question.type==='short_text'||question.type==='grammar_transform')&&<input aria-label={`Answer to question ${index+1}`} autoComplete="off" value={typeof selected==='string'?selected:''} onChange={event=>setAnswer(question.id,event.target.value)} className="mt-3 w-full rounded-lg bg-[#211638] p-3"/>}
      {(question.type==='fill_blank'||question.type==='formula')&&<input aria-label={`Answer to question ${index+1}`} autoComplete="off" value={typeof selected==='string'?selected:''} onChange={event=>setAnswer(question.id,event.target.value)} className="mt-3 w-full rounded-lg bg-[#211638] p-3"/>}
      {question.type==='ordering'&&<ol className="mt-3 grid gap-2">{ordered.map((item,itemIndex)=><li key={`${question.id}-${item}`} className="flex items-center justify-between rounded-lg border border-white/10 p-3"><span>{itemIndex+1}. {item}</span><span className="flex gap-1"><button type="button" aria-label={`Move ${item} up`} disabled={itemIndex===0} onClick={()=>moveItem(itemIndex,itemIndex-1)} className="rounded border border-white/15 px-2 disabled:opacity-30">↑</button><button type="button" aria-label={`Move ${item} down`} disabled={itemIndex===ordered.length-1} onClick={()=>moveItem(itemIndex,itemIndex+1)} className="rounded border border-white/15 px-2 disabled:opacity-30">↓</button></span></li>)}</ol>}
      {question.type==='matching'&&<div className="mt-3 grid gap-3">{(question.left_items||[]).map(left=><label key={left} className="grid gap-1 sm:grid-cols-[1fr_1fr] sm:items-center"><span>{left}</span><select aria-label={`Match for ${left}`} value={matches[left]||''} onChange={event=>setAnswer(question.id,updateMatchAnswer(matches,left,event.target.value))} className="rounded-lg bg-[#211638] p-3"><option value="">Choose a match</option>{(question.right_items||[]).map(right=><option key={right} value={right}>{right}</option>)}</select></label>)}</div>}
      {itemResult&&<div role="status" className={`mt-3 rounded-lg p-3 ${itemResult.correct?'bg-emerald-950/50 text-emerald-200':'bg-rose-950/40 text-rose-200'}`}><p>{itemResult.correct?'Correct':'Not quite'} · {itemResult.points_earned}/{itemResult.points_possible} points</p><p className="mt-1 text-sm">{itemResult.feedback}</p></div>}
    </fieldset>})}<button disabled={busy} className="rounded-lg bg-[#6350c8] px-6 py-3">{busy?'Scoring…':result?'Submit again':'Submit assessment'}</button></form>}
    {audioNotice&&<p role="status" className="mt-4 text-sm text-[#efc778]">{audioNotice}</p>}{result&&<p role="status" className="mt-5 rounded-lg bg-[#0e0621] p-4">Score: {Math.round(result.score*100)}% ({result.points_earned} of {result.points_possible} points). {result.feedback}</p>}{error&&<p role="alert" className="mt-4 text-rose-300">{error}</p>}
  </section></div></main>;
}

function Brand(){return <Link to="/" className="text-2xl font-semibold tracking-tight"><span className="text-[#efc778]">✳</span> starburst</Link>}


function CourseVersionHistory({courses,onRestored}:{courses:LearningRecord[];onRestored:(course:LearningRecord)=>void}) {
  const queryClient=useQueryClient();const [courseId,setCourseId]=useState('');const [notice,setNotice]=useState('');const versionsQuery=useQuery({...learningQueryOptions.courseVersions(courseId),enabled:Boolean(courseId)});const versions=versionsQuery.data??[];
  async function restore(version:number){try{const course=await pb.send<LearningRecord>(`/api/learning/courses/${courseId}/versions/${version}/restore`,{method:'POST',body:{}});onRestored(course);setNotice(`Restored as version ${course.version}`);await queryClient.invalidateQueries({queryKey:learningQueryOptions.courseVersions(courseId).queryKey})}catch(error){setNotice(error instanceof Error?error.message:'Could not restore course version')}}
  if(!courses.length)return null;
  return <section className="mt-5 rounded-xl border border-white/10 bg-[#211638] p-5"><h3 className="font-medium">Course versions</h3><select aria-label="Choose course history" className="mt-3 w-full rounded-lg bg-[#0e0621] p-3" value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">Select a course</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title} · v{c.version??0}</option>)}</select>{versions.map(v=><div key={v.version} className="mt-3 flex items-center justify-between rounded-lg bg-[#0e0621] p-3"><span className="text-sm">Version {v.version}{v.current?' · current':''}</span>{!v.current&&<button onClick={()=>void restore(v.version)} className="rounded-md bg-[#6350c8] px-3 py-1.5 text-sm">Restore</button>}</div>)}{notice&&<p role="status" className="mt-2 text-sm text-[#efc778]">{notice}</p>}</section>
}


function SourceImporter({onImported}:{onImported:(unit:LearningRecord)=>void}) {
 const queryClient=useQueryClient();const sourcesQuery=useQuery(learningQueryOptions.sources());const sources=sourcesQuery.data??[];const [title,setTitle]=useState('');const [content,setContent]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setMessage('');try{const result=await pb.send<{source:LearningSource;knowledge_unit:LearningRecord}>('/api/learning/sources',{method:'POST',body:{title,content,source_type:'text/markdown'}});onImported(result.knowledge_unit);setTitle('');setContent('');setMessage('Source saved and linked to a new concept.');await queryClient.invalidateQueries({queryKey:learningQueryOptions.sources().queryKey})}catch(e){setMessage(e instanceof Error?e.message:'Could not import source')}finally{setBusy(false)}}
 async function remove(id:string){try{await pb.send(`/api/learning/sources/${id}`,{method:'DELETE'});setMessage('Source and its linked concept were deleted.');await queryClient.invalidateQueries({queryKey:learningQueryOptions.sources().queryKey});await queryClient.invalidateQueries({queryKey:learningQueryOptions.knowledgeUnits().queryKey})}catch(e){setMessage(e instanceof Error?e.message:'Could not delete source')}}
 return <section className="mt-6 border-t border-white/10 pt-5"><h3 className="font-medium">Import notes</h3><form onSubmit={submit} className="mt-3 grid gap-2"><input className="rounded-lg bg-[#0e0621] p-3" placeholder="Source title" value={title} onChange={e=>setTitle(e.target.value)} required/><textarea className="min-h-28 rounded-lg bg-[#0e0621] p-3" placeholder="Paste text or Markdown" value={content} onChange={e=>setContent(e.target.value)} required/><button disabled={busy} className="rounded-lg bg-[#6350c8] p-2">{busy?'Saving…':'Import source'}</button></form><ul className="mt-3 divide-y divide-white/10">{sources.map(source=><li key={source.id} className="flex items-center justify-between py-2 text-sm"><span>{source.title}</span><button onClick={()=>void remove(source.id)} className="text-rose-300">Delete</button></li>)}</ul>{message&&<p role="status" className="mt-2 text-sm text-[#efc778]">{message}</p>}</section>
}

function SpeechPanel(){
 const piperQuery=useQuery(learningQueryOptions.piperHealth());const [text,setText]=useState('Learning grows when you connect ideas.');const [status,setStatus]=useState('Checking Piper…');const [audioUrl,setAudioUrl]=useState('');const [busy,setBusy]=useState(false);const [transcript,setTranscript]=useState('');
 useEffect(()=>{if(piperQuery.data)setStatus(piperQuery.data.connected?'Piper connected':piperQuery.data.configured?'Piper unavailable':'Piper is not configured');else if(piperQuery.error)setStatus('Speech status unavailable')},[piperQuery.data,piperQuery.error]);
 useEffect(()=>()=>{if(audioUrl)URL.revokeObjectURL(audioUrl)},[audioUrl]);
 async function synthesize(){setBusy(true);try{const response=await fetch(pb.buildUrl('/api/speech/synthesize'),{method:'POST',headers:{'Content-Type':'application/json','Authorization':pb.authStore.token},body:JSON.stringify({text})});if(!response.ok)throw new Error('Piper synthesis failed');const blob=await response.blob();if(audioUrl)URL.revokeObjectURL(audioUrl);const url=URL.createObjectURL(blob);setAudioUrl(url);setStatus('Audio ready')}catch(e){setStatus(e instanceof Error?e.message:'Synthesis failed')}finally{setBusy(false)}}
 return <section className="mt-6 border-t border-white/10 pt-5"><h3 className="font-medium">Speech</h3><p className="mt-1 text-xs text-[#b7adcc]">{status}</p><textarea aria-label="Text to speak" className="mt-3 min-h-20 w-full rounded-lg bg-[#0e0621] p-3 text-sm" value={text} onChange={e=>setText(e.target.value)}/><button disabled={busy} onClick={()=>void synthesize()} className="mt-2 rounded-lg bg-[#6350c8] px-4 py-2 text-sm">{busy?'Generating…':'Preview voice'}</button>{audioUrl&&<audio className="mt-3 w-full" controls src={audioUrl}/>}<label className="mt-5 block text-sm">Transcribe WAV recording<input className="mt-2 block w-full text-xs" type="file" accept="audio/wav,.wav" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const response=await fetch(pb.buildUrl("/api/speech/transcribe"),{method:"POST",headers:{"Content-Type":"audio/wav","Authorization":pb.authStore.token},body:file});if(!response.ok)throw new Error("Transcription failed");const result=await response.json();setTranscript(result.text);setStatus("Transcription complete")}catch(error){setStatus(error instanceof Error?error.message:"Transcription failed")}}}/></label>{transcript&&<p className="mt-2 rounded bg-[#0e0621] p-3 text-sm">{transcript}</p>}</section>
}


function WidgetStage({type,config,initialState,onStateChange}:{type:string;config:WidgetConfig;initialState:WidgetInteractionState;onStateChange:(state:WidgetInteractionState)=>void}) {
 const [value,setValueState]=useState(initialState.value??0);const [choice,setChoiceState]=useState(initialState.choice??'');const [checked,setCheckedState]=useState(initialState.checked??false);
 const setValue=(next:number)=>{setValueState(next);onStateChange({value:next,choice,checked})};
 const setChoice=(next:string)=>{setChoiceState(next);onStateChange({value,choice:next,checked})};
 const setChecked=(next:boolean)=>{setCheckedState(next);onStateChange({value,choice,checked:next})};
 if(type==='number_line'){const min=Number(config.min??-10),max=Number(config.max??10),target=Number(config.target??0);return <div className="mt-8"><p className="text-lg text-[#efc778]">{config.prompt??'Explore the number line'}</p><div className="mt-5 flex justify-between font-mono text-sm">{Array.from({length:11},(_,i)=>min+(max-min)*i/10).map(n=><span key={n}>{Number(n.toFixed(1))}</span>)}</div><input aria-label="Number line value" type="range" min={min} max={max} step={(max-min)/100} value={value} onChange={e=>setValue(Number(e.target.value))} className="mt-2 w-full accent-[#e57fab]"/><p className="mt-2">Selected: {value.toFixed(1)}{checked&&<span className="ml-3 text-[#efc778]">Target: {target}</span>}</p><button onClick={()=>setChecked(true)} className="mt-3 rounded bg-[#6350c8] px-3 py-2">Check position</button></div>}
 if(type==='binary_explorer'){const number=Math.max(0,Math.min(255,Math.round(value)));return <div className="mt-8"><p>{config.prompt??'Explore how a byte stores a number.'}</p><input aria-label="Byte value" type="range" min="0" max="255" value={number} onChange={e=>setValue(Number(e.target.value))} className="mt-5 w-full accent-[#e57fab]"/><div className="mt-4 flex items-center justify-between rounded-xl bg-[#0e0621] p-5 font-mono"><span>{number.toString(2).padStart(8,'0')}</span><span>= {number}</span></div></div>}
 if(type==='matching'){const options:Array<string>=Array.isArray(config.options)?config.options:[];return <div className="mt-8"><p>{config.prompt??'Choose the best match.'}</p><div className="mt-4 grid gap-2">{options.map(option=><button key={option} aria-pressed={choice===option} onClick={()=>{setChoice(option);setChecked(false)}} className={`rounded-lg border p-3 text-left ${choice===option?'border-[#e57fab] bg-[#0e0621]':'border-white/10'}`}>{option}</button>)}</div><button disabled={!choice} onClick={()=>setChecked(true)} className="mt-4 rounded bg-[#6350c8] px-3 py-2">Check answer</button>{checked&&<p role="status" className="mt-3">{choice===config.answer?'That matches.':'Try again and compare the choices.'}</p>}</div>}
 if(type==='timeline'){const events:Array<{label:string;detail?:string}>=Array.isArray(config.events)?config.events:[];return <ol className="mt-8 space-y-3">{events.map((event,i)=><li key={`${i}-${event.label}`} className="flex gap-4 rounded-lg bg-[#0e0621] p-4"><span className="font-mono text-[#f3a178]">{String(i+1).padStart(2,'0')}</span><div><p>{event.label}</p>{event.detail&&<p className="mt-1 text-sm text-[#b7adcc]">{event.detail}</p>}</div></li>)}</ol>}
 if(type==='geometry_explorer')return <GeometryExplorer config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='vector_visualizer')return <VectorExplorer config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='logic_gates')return <LogicGateExplorer config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='algorithm_step_visualizer')return <BinarySearchVisualizer config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='probability_simulation')return <ProbabilitySimulation config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='state_machine_visualizer')return <StateMachineVisualizer config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='classification')return <ClassificationExercise config={config} state={initialState} onStateChange={state=>onStateChange({...initialState,...state})}/>;
 if(type==='function_plotter'){const shift=initialState.plotShift??value;return <div className="mt-8"><p>{config.prompt??'Explore the shape of y = x².'}</p><svg viewBox="0 0 240 140" role="img" aria-label={`Parabola shifted horizontally ${shift}`} className="mt-4 h-48 w-full rounded-lg bg-[#0e0621]"><path d="M20 20H220M120 10V130" stroke="#81779a"/><path d={`M${30+shift*8} 30 Q${120+shift*8} 130 ${210+shift*8} 30`} fill="none" stroke="#e57fab" strokeWidth="4"/></svg><label className="mt-3 block text-sm">Horizontal shift <input aria-label="Horizontal shift" type="range" min="-5" max="5" value={shift} onChange={e=>{const next=Number(e.target.value);setValue(next);onStateChange({...initialState,plotShift:next});}} className="ml-3 accent-[#e57fab]"/> {shift}</label></div>}
 return <div className="mt-8">{config.prompt&&<p className="text-xl text-[#efc778]">{config.prompt}</p>}{config.body&&<p className="mt-4 max-w-2xl leading-7 text-[#d4cde2]">{config.body}</p>}{config.steps&&<ol className="mt-8 grid gap-3">{config.steps.map((step:string,i:number)=><li key={step} className="rounded-lg bg-[#0e0621] p-4"><span className="mr-3 text-[#f3a178]">0{i+1}</span>{step}</li>)}</ol>}{config.question&&<textarea className="mt-6 min-h-32 w-full rounded-lg border border-white/10 bg-[#0e0621] p-4" placeholder="Write your explanation" aria-label="Your explanation"/>}</div>
}

function GeometryExplorer({config,state,onStateChange}:{config:WidgetConfig;state:WidgetInteractionState;onStateChange:(state:WidgetInteractionState)=>void}) {
 const defaultSideA=Number(config.side_a??6);const defaultSideB=Number(config.side_b??8);const defaultAngle=Number(config.angle_degrees??60);
 const [sideA,setSideA]=useState(state.sideA??defaultSideA);const [sideB,setSideB]=useState(state.sideB??defaultSideB);const [angle,setAngle]=useState(state.angle??defaultAngle);
 const {sideC,area}=triangleMetrics(sideA,sideB,angle);const scale=160/Math.max(sideA,sideB,sideC);const angleRadians=angle*Math.PI/180;
 const rawC={x:sideB*Math.cos(angleRadians)*scale,y:-sideB*Math.sin(angleRadians)*scale};const rawB={x:sideA*scale,y:0};
 const minX=Math.min(0,rawB.x,rawC.x);const maxX=Math.max(0,rawB.x,rawC.x);const offsetX=(280-(maxX-minX))/2-minX;const offsetY=18+Math.max(0,-rawC.y);
 const pointA={x:offsetX,y:offsetY};const pointB={x:offsetX+rawB.x,y:offsetY};const pointC={x:offsetX+rawC.x,y:offsetY+rawC.y};
 const midpoint=(left:{x:number;y:number},right:{x:number;y:number})=>({x:(left.x+right.x)/2,y:(left.y+right.y)/2});
 const labelA=midpoint(pointA,pointB);const labelB=midpoint(pointA,pointC);const labelC=midpoint(pointB,pointC);
 function reset(){setSideA(defaultSideA);setSideB(defaultSideB);setAngle(defaultAngle)}
 return <section className="mt-8" aria-labelledby="geometry-explorer-heading">
   <h3 id="geometry-explorer-heading" className="text-lg font-medium">{config.prompt||'Explore a triangle'}</h3>
   <p className="mt-2 text-sm text-[#b7adcc]">Change the side lengths and included angle. The third side follows the law of cosines; the area updates with each change.</p>
   <svg viewBox="0 0 280 190" role="img" aria-labelledby="geometry-triangle-title geometry-triangle-description" className="mt-4 h-56 w-full rounded-xl bg-[#0e0621]">
     <title id="geometry-triangle-title">Interactive triangle model</title>
     <desc id="geometry-triangle-description">Triangle with side a {sideA.toFixed(1)}, side b {sideB.toFixed(1)}, included angle {angle} degrees, and calculated side c {sideC.toFixed(2)}.</desc>
     <polygon points={`${pointA.x},${pointA.y} ${pointB.x},${pointB.y} ${pointC.x},${pointC.y}`} fill="#6350c8" fillOpacity="0.22" stroke="#e57fab" strokeWidth="3"/>
     {[pointA,pointB,pointC].map((point,index)=><g key={index}><circle cx={point.x} cy={point.y} r="4" fill="#efc778"/><text x={point.x+(index===1?6:-14)} y={point.y-7} fill="#f8f5fc" fontSize="12">{String.fromCharCode(65+index)}</text></g>)}
     <text x={labelA.x} y={labelA.y+16} fill="#f8f5fc" fontSize="12" textAnchor="middle">a {sideA.toFixed(1)}</text>
     <text x={labelB.x-8} y={labelB.y} fill="#f8f5fc" fontSize="12" textAnchor="middle">b {sideB.toFixed(1)}</text>
     <text x={labelC.x+8} y={labelC.y} fill="#f8f5fc" fontSize="12" textAnchor="middle">c {sideC.toFixed(2)}</text>
     <text x={pointA.x+12} y={pointA.y-11} fill="#efc778" fontSize="11">{angle}°</text>
   </svg>
   <div className="mt-4 grid gap-4 sm:grid-cols-2">
     <label htmlFor="geometry-side-a" className="grid gap-1 text-sm">Side a · {sideA.toFixed(1)}<input id="geometry-side-a" type="range" min="0.5" max="20" step="0.5" value={sideA} onChange={event=>{const next=Number(event.target.value);setSideA(next);onStateChange({...state,sideA:next});}} className="accent-[#e57fab]"/></label>
     <label htmlFor="geometry-side-b" className="grid gap-1 text-sm">Side b · {sideB.toFixed(1)}<input id="geometry-side-b" type="range" min="0.5" max="20" step="0.5" value={sideB} onChange={event=>{const next=Number(event.target.value);setSideB(next);onStateChange({...state,sideB:next});}} className="accent-[#e57fab]"/></label>
     <label htmlFor="geometry-included-angle" className="grid gap-1 text-sm sm:col-span-2">Included angle · {angle}°<input id="geometry-included-angle" type="range" min="15" max="165" step="1" value={angle} onChange={event=>{const next=Number(event.target.value);setAngle(next);onStateChange({...state,angle:next});}} className="accent-[#e57fab]"/></label>
   </div>
   <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-[#0e0621] p-3 text-sm">Side c: {sideC.toFixed(2)} units · Area: {area.toFixed(2)} square units</p>
   <button type="button" onClick={()=>{reset();onStateChange({sideA:defaultSideA,sideB:defaultSideB,angle:defaultAngle});}} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset triangle</button>
 </section>;
}

function VocabularyPanel(){
 const queryClient=useQueryClient();const wordsQuery=useQuery(learningQueryOptions.vocabulary());const words=wordsQuery.data??[];const [language,setLanguage]=useState('');const [setName,setSetName]=useState('');const [raw,setRaw]=useState('');const [index,setIndex]=useState(0);const [revealed,setRevealed]=useState(false);const [message,setMessage]=useState('');const [mode,setMode]=useState<'listening'|'context'|''>('');const [answer,setAnswer]=useState('');const [attempt,setAttempt]=useState('');const [audioBusy,setAudioBusy]=useState(false);const [audioUrl,setAudioUrl]=useState('');
 useEffect(()=>()=>{if(audioUrl)URL.revokeObjectURL(audioUrl)},[audioUrl]);
 async function add(event:React.FormEvent){event.preventDefault();const entries=raw.split('\n').map(line=>{const [pair,example='']=line.split('|').map(part=>part.trim());const [term,translation]=pair.split('=').map(part=>part.trim());return {term,translation,example_sentence:example}}).filter(entry=>entry.term&&entry.translation);if(!entries.length){setMessage('Enter term = translation, with an optional | example sentence on each line.');return}try{await pb.send('/api/languages/vocabulary',{method:'POST',body:{language,set_name:setName,words:entries}});setRaw('');setMessage(`${entries.length} words added.`);await queryClient.invalidateQueries({queryKey:learningQueryOptions.vocabulary().queryKey})}catch(e){setMessage(e instanceof Error?e.message:'Could not add vocabulary')}}
 async function rate(quality:number){const word=words[index];if(!word)return;try{await pb.send(`/api/learning/reviews/${word.id}`,{method:'POST',body:{quality}});setIndex((index+1)%words.length);setRevealed(false)}catch(e){setMessage(e instanceof Error?e.message:'Could not save review')}}
 const current=words[index];
 function startActivity(next:'listening'|'context'){if(!current?.metadata.example_sentence){setMessage('Add an example sentence to this vocabulary item first.');return}setMode(next);setAnswer('');setAttempt('');setRevealed(false)}
 async function playExample(){if(!current?.metadata.example_sentence)return;setAudioBusy(true);try{const response=await fetch(pb.buildUrl('/api/speech/synthesize'),{method:'POST',headers:{'Content-Type':'application/json','Authorization':pb.authStore.token},body:JSON.stringify({text:current.metadata.example_sentence})});if(!response.ok)throw new Error('Piper could not speak this example');const url=URL.createObjectURL(await response.blob());setAudioUrl(previous=>{if(previous)URL.revokeObjectURL(previous);return url});setMessage('Example audio ready. Listen, then enter the vocabulary word you heard.')}catch(error){setMessage(error instanceof Error?error.message:'Could not create example audio')}finally{setAudioBusy(false)}}
 async function submitActivity(event:React.FormEvent){event.preventDefault();if(!current||!mode)return;try{const result=await pb.send<{correct:boolean;feedback:string;example_sentence?:string}>(`/api/languages/vocabulary/${current.id}/context-attempt`,{method:'POST',body:{mode,answer}});setAttempt(result.feedback);setRevealed(true)}catch(error){setAttempt(error instanceof Error?error.message:'Could not submit answer')}}
 function closeActivity(){setMode('');setAnswer('');setAttempt('');setAudioUrl(previous=>{if(previous)URL.revokeObjectURL(previous);return ''})}
 return <section className="mt-7 border-t border-white/10 pt-5"><h3 className="font-medium">Vocabulary practice</h3><p className="mt-1 text-sm text-[#b7adcc]">Add terms, translations, and example sentences. Reviews update the shared mastery schedule.</p><form onSubmit={add} className="mt-3 grid gap-2"><div className="grid gap-2 sm:grid-cols-2"><input className="rounded-lg bg-[#0e0621] p-2" placeholder="Language (e.g. Spanish)" value={language} onChange={e=>setLanguage(e.target.value)} required/><input className="rounded-lg bg-[#0e0621] p-2" placeholder="Set name" value={setName} onChange={e=>setSetName(e.target.value)}/></div><textarea className="min-h-24 rounded-lg bg-[#0e0621] p-3 text-sm" placeholder={'hola = hello | Hola, ¿cómo estás?\ngracias = thank you | Gracias por tu ayuda.'} value={raw} onChange={e=>setRaw(e.target.value)}/><p className="text-xs text-[#b7adcc]">Use <code>term = translation | example sentence</code>. The example is optional.</p><button className="rounded-lg bg-[#aa65c9] p-2">Add vocabulary</button></form>{message&&<p role="status" className="mt-2 text-sm text-[#efc778]">{message}</p>}{current&&<div className="mt-4 rounded-xl bg-[#211638] p-4"><p className="text-xs text-[#b7adcc]">{current.metadata.language} · {current.metadata.set_name||'Vocabulary'}</p>{mode?<><h4 className="mt-3 font-medium">{mode==='listening'?'Listening comprehension':'Use it in context'}</h4><p className="mt-1 text-sm text-[#b7adcc]">{mode==='listening'?'Play the spoken example and type the vocabulary word you hear.':'Write a sentence that uses the vocabulary word shown by the example.'}</p>{mode==='listening'?<><button type="button" disabled={audioBusy} onClick={()=>void playExample()} className="mt-3 rounded bg-[#6350c8] px-3 py-2">{audioBusy?'Preparing audio…':'Play example'}</button>{audioUrl&&<audio className="mt-3 w-full" controls src={audioUrl}/>}</>:<p className="mt-3 rounded bg-[#0e0621] p-3">{current.metadata.example_sentence}</p>}<form onSubmit={event=>void submitActivity(event)} className="mt-3 grid gap-2"><input aria-label={mode==='listening'?'Word heard':'Your example sentence'} className="rounded-lg bg-[#0e0621] p-3" value={answer} onChange={event=>setAnswer(event.target.value)} required placeholder={mode==='listening'?'Type the word you heard':'Write a sentence using the word'}/><div className="flex gap-2"><button className="rounded bg-[#aa65c9] px-3 py-2">Check answer</button><button type="button" onClick={closeActivity} className="rounded border border-white/15 px-3 py-2">Back to card</button></div></form>{attempt&&<p role="status" className="mt-3 text-sm text-[#efc778]">{attempt}</p>}{revealed&&<p className="mt-3 rounded bg-[#0e0621] p-3 text-sm">{current.metadata.example_sentence}</p>}</>:<><p className="mt-3 text-2xl font-semibold">{current.term}</p>{revealed?<p className="mt-2 text-[#efc778]">{current.metadata.translation}</p>:<button onClick={()=>setRevealed(true)} className="mt-2 text-sm text-[#e57fab]">Reveal translation</button>}{revealed&&<div className="mt-4 flex flex-wrap gap-2">{[['Again',1],['Hard',3],['Good',4],['Easy',5]].map(([label,value])=><button key={label} onClick={()=>void rate(Number(value))} className="rounded bg-[#6350c8] px-3 py-2 text-sm">{label}</button>)}</div>}<p className="mt-3 text-xs text-[#b7adcc]">Card {index+1} of {words.length}</p>{current.metadata.example_sentence&&<div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>startActivity('listening')} className="rounded border border-white/15 px-3 py-2 text-sm">Listening practice</button><button onClick={()=>startActivity('context')} className="rounded border border-white/15 px-3 py-2 text-sm">Use in context</button></div>}</>}</div>}{words.length>0&&!mode&&<ul className="mt-3 text-sm text-[#b7adcc]">{words.map(word=><li key={word.id}>{word.term} — {word.metadata.translation} <span className="text-xs">({word.metadata.language})</span></li>)}</ul>}</section>
}

function GrammarPanel(){
 const queryClient=useQueryClient();const itemsQuery=useQuery(learningQueryOptions.grammar());const items=itemsQuery.data??[];const [language,setLanguage]=useState('');const [raw,setRaw]=useState('');const [answers,setAnswers]=useState<Record<string,string>>({});const [feedback,setFeedback]=useState<Record<string,string>>({});const [message,setMessage]=useState('');
 async function create(event:React.FormEvent){event.preventDefault();const entries=raw.split('\n').map(row=>row.split('|').map(part=>part.trim())).filter(parts=>parts.length>=2&&parts[0]&&parts[1]).map(([prompt,answer,explanation])=>({prompt,answer,explanation:explanation||''}));if(!entries.length){setMessage('Use prompt | accepted answer | explanation per line.');return}try{await pb.send('/api/languages/grammar',{method:'POST',body:{language,items:entries}});setRaw('');setMessage('Grammar exercises saved.');await queryClient.invalidateQueries({queryKey:learningQueryOptions.grammar().queryKey})}catch(e){setMessage(e instanceof Error?e.message:'Could not save grammar set')}}
 async function answer(item:GrammarRecord,response=answers[item.id]||''){try{const result=await pb.send<{feedback:string;correct:boolean}>(`/api/languages/grammar/${item.id}/answer`,{method:'POST',body:{answer:response}});setFeedback(values=>({...values,[item.id]:result.feedback}))}catch(e){setFeedback(values=>({...values,[item.id]:e instanceof Error?e.message:'Could not submit answer'}))}}
 return <section className="mt-7 border-t border-white/10 pt-5"><h3 className="font-medium">Grammar practice</h3><p className="mt-1 text-sm text-[#b7adcc]">Create cloze-style prompts and practice accepted transformations.</p><form onSubmit={create} className="mt-3 grid gap-2"><input className="rounded-lg bg-[#0e0621] p-2" placeholder="Language" value={language} onChange={e=>setLanguage(e.target.value)} required/><textarea className="min-h-24 rounded-lg bg-[#0e0621] p-3 text-sm" placeholder={'She ___ to school. | goes | Third-person singular adds -s.'} value={raw} onChange={e=>setRaw(e.target.value)}/><button className="rounded-lg bg-[#aa65c9] p-2">Save exercises</button></form>{message&&<p role="status" className="mt-2 text-sm text-[#efc778]">{message}</p>}<ul className="mt-4 space-y-3">{items.map(item=><li key={item.id} className="rounded-lg bg-[#211638] p-3"><p className="text-xs text-[#b7adcc]">{item.language}</p><p className="mt-1">{item.prompt}</p><div className="mt-2 flex gap-2"><input aria-label="Grammar answer" className="min-w-0 flex-1 rounded bg-[#0e0621] p-2" value={answers[item.id]||''} onChange={e=>setAnswers(values=>({...values,[item.id]:e.target.value}))}/><button onClick={()=>void answer(item)} className="rounded bg-[#6350c8] px-3">Check</button></div><label className="mt-2 block text-xs text-[#b7adcc]">Speak your answer (PCM WAV)<input className="mt-1 block w-full" type="file" accept="audio/wav,.wav" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const response=await fetch(pb.buildUrl('/api/speech/transcribe'),{method:'POST',headers:{'Content-Type':'audio/wav','Authorization':pb.authStore.token},body:file});if(!response.ok)throw new Error('Transcription failed');const result=await response.json();setAnswers(values=>({...values,[item.id]:result.text}));await answer(item,result.text)}catch(error){setFeedback(values=>({...values,[item.id]:error instanceof Error?error.message:'Speech answer failed'}))}}}/></label>{feedback[item.id]&&<p role="status" className="mt-2 text-sm text-[#efc778]">{feedback[item.id]}</p>}</li>)}</ul></section>
}

function CoursePortability({courses,onImported,onArchiveImported}:{courses:LearningRecord[];onImported:(course:LearningRecord)=>void;onArchiveImported:()=>void}){
 const [selected,setSelected]=useState('');const [file,setFile]=useState<File|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function exportSelected(){if(!selected)return;try{const data=await pb.send('/api/learning/courses/'+selected+'/export',{method:'GET'});const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='starburst-course.json';link.click();URL.revokeObjectURL(url)}catch(e){setMessage(e instanceof Error?e.message:'Export failed')}}
 async function exportArchive(){try{const response=await fetch(pb.buildUrl('/api/account/learning-export/archive'),{headers:{Authorization:pb.authStore.token}});if(!response.ok)throw new Error('Archive export failed');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='starburst-learning-archive.zip';link.click();URL.revokeObjectURL(url)}catch(e){setMessage(e instanceof Error?e.message:'Archive export failed')}}
 async function importArchive(){if(!file)return;setBusy(true);try{if(file.name.toLowerCase().endsWith('.zip')){const response=await fetch(pb.buildUrl('/api/account/learning-import'),{method:'POST',headers:{Authorization:pb.authStore.token,'Content-Type':'application/zip'},body:file});if(!response.ok)throw new Error('Archive import failed')}else await pb.send('/api/account/learning-import',{method:'POST',body:JSON.parse(await file.text())});setMessage('Learning archive imported.');setFile(null);onArchiveImported()}catch(e){setMessage(e instanceof Error?e.message:'Archive import failed')}finally{setBusy(false)}}
 async function importFile(){if(!file)return;setBusy(true);try{const text=await file.text();const record=await pb.send<LearningRecord>('/api/learning/courses/import',{method:'POST',body:JSON.parse(text)});onImported(record);setMessage('Course imported.');setFile(null)}catch(e){setMessage(e instanceof Error?e.message:'Import failed')}finally{setBusy(false)}}
 return <section className="mt-5 rounded-xl border border-white/10 bg-[#211638] p-5"><h3 className="font-medium">Course portability</h3><button onClick={()=>void exportArchive()} className="mt-3 rounded bg-[#aa65c9] px-3 py-2 text-sm">Export all learning data</button><div className="mt-3 flex gap-2"><select aria-label="Course to export" className="min-w-0 flex-1 rounded-lg bg-[#0e0621] p-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a course to export</option>{courses.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select><button disabled={!selected} onClick={()=>void exportSelected()} className="rounded bg-[#6350c8] px-3">Export JSON</button></div><label className="mt-4 block text-sm">Import Starburst course or account archive<input className="mt-2 block w-full text-xs" type="file" accept="application/json,.json,application/zip,.zip" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>{file&&<div className="mt-2 flex gap-2"><button disabled={busy||file.name.toLowerCase().endsWith('.zip')} onClick={()=>void importFile()} className="rounded bg-[#aa65c9] px-3 py-2">{busy?'Importing…':'Import course'}</button><button disabled={busy} onClick={()=>void importArchive()} className="rounded border border-white/15 px-3 py-2">{file.name.toLowerCase().endsWith('.zip')?'Import archive':'Import learning archive'}</button></div>}{message&&<p role="status" className="mt-2 text-sm text-[#efc778]">{message}</p>}</section>
}
