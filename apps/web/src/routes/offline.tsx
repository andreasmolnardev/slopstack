import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { getCourseProgress } from '../api/generated/sdk.gen';
import { client as generatedClient } from '../api/generated/client.gen';
import { learningQueryOptions } from '../api/learning-queries';
import { offlineLearningStore, type DownloadedLesson } from '../api/offline-learning';
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
  const [online, setOnline] = useState(navigator.onLine);
  const [selectedCourse, setSelectedCourse] = useState<DownloadedLesson | null>(null);
  const [busyCourseId, setBusyCourseId] = useState('');
  const [message, setMessage] = useState('');
  const downloadsQuery = useQuery({
    queryKey: ['offline-library', ownerId],
    queryFn: () => offlineLearningStore.listCourses(ownerId),
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
    if (nextOwnerId !== ownerId || !token) {
      setOwnerId(nextOwnerId);
      setSelectedCourse(null);
      setMessage('');
    }
    if (!token || !model) void navigate({ to: '/login', search: { redirect: '/offline' } });
  }), [navigate, ownerId]);

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
    await offlineLearningStore.removeCourse(ownerId, download.course.id);
    if (selectedCourse?.course.id === download.course.id) setSelectedCourse(null);
    await queryClient.invalidateQueries({ queryKey: ['offline-library', ownerId] });
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
              <div className="mt-4 flex gap-2">
                <button onClick={() => setSelectedCourse(download)} className="rounded-lg bg-[#6350c8] px-4 py-2 text-sm">Read offline</button>
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
