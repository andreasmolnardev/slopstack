import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createIndexedDbOfflineLearningStore,
  persistProgressOfflineFirst,
  syncQueuedProgress,
  syncQueuedAssessments,
  sanitizeDownloadedCourse,
  MAX_OFFLINE_NARRATION_BYTES,
  type OfflineLearningStore,
  type PendingCourseProgress,
  type PendingOfflineAssessment,
} from './api/offline-learning';

let store: OfflineLearningStore;
let databaseNumber = 0;

beforeEach(() => {
  store = createIndexedDbOfflineLearningStore(indexedDB, `starburst-offline-test-${databaseNumber++}`);
});

const course = (id: string) => ({ id, title: `Course ${id}`, content: { modules: [] } });
const progress = (ownerId: string, courseId: string, sceneIndex: number): PendingCourseProgress => ({
  ownerId,
  courseId,
  sceneIndex,
  positionSeconds: sceneIndex * 12,
  completed: false,
  updatedAt: Date.now(),
});
const assessment = (ownerId: string, requestId: string, courseId = 'course-1'): PendingOfflineAssessment => ({
  ownerId,
  courseId,
  courseVersion: 2,
  requestId,
  answers: { q1: 'choice-a' },
  queuedAt: Date.now(),
});

describe('offline learning storage', () => {
  it('keeps downloads separated by owner and removes only the selected owner data', async () => {
    await store.saveCourse('learner-a', course('course-1'));
    await store.saveCourse('learner-b', course('course-1'));
    await store.queueProgress(progress('learner-a', 'course-1', 2));
    await store.queueProgress(progress('learner-b', 'course-1', 4));
    await store.queueAssessment(assessment('learner-a', 'attempt-a'));
    await store.queueAssessment(assessment('learner-b', 'attempt-b'));
    await store.saveNarrationAssets('learner-a', 'course-1', 2, [new Blob(['audio-a'])]);
    await store.saveNarrationAssets('learner-b', 'course-1', 2, [new Blob(['audio-b'])]);

    await store.clearUser('learner-a');

    expect(await store.listCourses('learner-a')).toEqual([]);
    expect(await store.listQueuedProgress('learner-a')).toEqual([]);
    expect(await store.listQueuedAssessments('learner-a')).toEqual([]);
    expect(await store.getNarrationAssets('learner-a', 'course-1', 2)).toBeUndefined();
    expect(await store.getNarrationAssets('learner-b', 'course-1', 2)).toHaveLength(1);
    expect((await store.listCourses('learner-b')).map((item) => item.course.title)).toEqual(['Course course-1']);
    expect((await store.listQueuedProgress('learner-b'))[0].sceneIndex).toBe(4);
    expect((await store.listQueuedAssessments('learner-b'))[0].requestId).toBe('attempt-b');
  });

  it('stores narration by owner, course, and version and removes it with the download', async () => {
    const blob = new Blob(['lesson audio'], { type: 'audio/wav' });
    await store.saveNarrationAssets('learner-a', 'course-1', 3, [blob]);
    await store.saveNarrationAssets('learner-a', 'course-1', 4, [new Blob(['new version'])]);
    expect(await store.getNarrationAssets('learner-a', 'course-1', 3)).toEqual([blob]);
    expect(await store.getNarrationAssets('learner-a', 'course-1', 4)).toHaveLength(1);
    expect(await store.getNarrationAssets('learner-b', 'course-1', 3)).toBeUndefined();
    await store.removeCourse('learner-a', 'course-1');
    expect(await store.getNarrationAssets('learner-a', 'course-1', 3)).toBeUndefined();
    expect(await store.getNarrationAssets('learner-a', 'course-1', 4)).toBeUndefined();
  });

  it('rejects empty or oversized narration downloads', async () => {
    await expect(store.saveNarrationAssets('learner-a', 'course-1', 1, [])).rejects.toThrow('empty');
    await expect(store.saveNarrationAssets('learner-a', 'course-1', 1, [new Blob([new Uint8Array(MAX_OFFLINE_NARRATION_BYTES + 1)])])).rejects.toThrow('25 MiB');
  });

  it('stores the latest offline resume position and syncs it on reconnect', async () => {
    await store.saveCourse('learner-a', course('course-1'), { sceneIndex: 0, positionSeconds: 0, completed: false });
    const writes: PendingCourseProgress[] = [];
    const offline = () => false;
    const online = () => true;
    const saveOnline = async (entry: PendingCourseProgress) => { writes.push(entry); };

    await persistProgressOfflineFirst(progress('learner-a', 'course-1', 1), store, saveOnline, offline);
    await persistProgressOfflineFirst(progress('learner-a', 'course-1', 3), store, saveOnline, offline);
    expect((await store.listQueuedProgress('learner-a'))).toHaveLength(1);
    expect(await store.getSavedProgress('learner-a', 'course-1')).toMatchObject({ sceneIndex: 3, positionSeconds: 36 });

    expect(await syncQueuedProgress('learner-a', store, saveOnline, online)).toBe(1);
    expect(writes.map((entry) => entry.sceneIndex)).toEqual([3]);
    expect(await store.listQueuedProgress('learner-a')).toEqual([]);
    expect(await store.getSavedProgress('learner-a', 'course-1')).toMatchObject({ sceneIndex: 3, positionSeconds: 36 });
  });

  it('retains a queued position if its server sync fails', async () => {
    await store.queueProgress(progress('learner-a', 'course-1', 2));

    const synced = await syncQueuedProgress('learner-a', store, async () => { throw new Error('offline'); }, () => true);

    expect(synced).toBe(0);
    expect((await store.listQueuedProgress('learner-a'))[0].sceneIndex).toBe(2);
  });

  it('queues a position when an online save fails after the connection drops', async () => {
    await store.saveCourse('learner-a', course('course-1'));

    const result = await persistProgressOfflineFirst(
      progress('learner-a', 'course-1', 5),
      store,
      async () => { throw new TypeError('Failed to fetch'); },
      () => true,
    );

    expect(result.queued).toBe(true);
    expect((await store.listQueuedProgress('learner-a'))[0].sceneIndex).toBe(5);
    expect(await store.getSavedProgress('learner-a', 'course-1')).toMatchObject({ sceneIndex: 5, positionSeconds: 60 });
  });

  it('strips private assessment keys before a course is stored offline', async () => {
    const unsafeCourse = {
      id: 'course-keys',
      title: 'Private keys',
      content: { modules: [{ assessment: { questions: [{
        id: 'q1', type: 'multiple_choice', prompt: 'Pick one', choices: ['a', 'b'], points: 1,
        correct_answer: 'a', accepted_answers: ['a'], rationale: 'A is right.',
      }] } }] },
    };

    await store.saveCourse('learner-a', unsafeCourse);

    const saved = await store.getCourse('learner-a', 'course-keys');
    const question = ((saved?.course.content?.modules as { assessment: { questions: Record<string, unknown>[] } }[])[0].assessment.questions)[0];
    expect(question).toMatchObject({ id: 'q1', type: 'multiple_choice', choices: ['a', 'b'], points: 1 });
    expect(question).not.toHaveProperty('correct_answer');
    expect(question).not.toHaveProperty('accepted_answers');
    expect(question).not.toHaveProperty('rationale');
  });

  it('sanitizes every supported private answer-key field', () => {
    const safe = sanitizeDownloadedCourse({
      id: 'course-keys', title: 'Private keys', content: { modules: [{ assessment: { questions: [
        { id: 'mc', correct_answer: 'x', correct_answers: ['x'], accepted_answers: ['x'], rationale: 'why' },
        { id: 'order', correct_order: ['a', 'b'] },
        { id: 'match', correct_matches: { a: 'b' } },
        { id: 'listen', type: 'listening', audio_text: 'The train arrives at noon.', choices: ['At noon', 'At two'], correct_answer: 'At noon' },
      ] } }] },
    });
    const questions = (safe.content?.modules as { assessment: { questions: Record<string, unknown>[] } }[])[0].assessment.questions;
    expect(questions).toEqual([{ id: 'mc' }, { id: 'order' }, { id: 'match' }, { id: 'listen', type: 'listening', audio_text: 'The train arrives at noon.', choices: ['At noon', 'At two'] }]);
  });

  it('queues assessments by owner and submits only once when connectivity returns', async () => {
    await store.queueAssessment(assessment('learner-a', 'attempt-a'));
    await store.queueAssessment(assessment('learner-b', 'attempt-b'));
    const writes: PendingOfflineAssessment[] = [];
    const submit = async (attempt: PendingOfflineAssessment) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      writes.push(attempt);
    };
    expect(await syncQueuedAssessments('learner-a', store, submit, () => false)).toBe(0);
    expect(await store.listQueuedAssessments('learner-a')).toHaveLength(1);

    const [first, second] = await Promise.all([
      syncQueuedAssessments('learner-a', store, submit, () => true),
      syncQueuedAssessments('learner-a', store, submit, () => true),
    ]);
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(writes.map((entry) => entry.requestId)).toEqual(['attempt-a']);
    expect(await store.listQueuedAssessments('learner-a')).toEqual([]);
    expect((await store.listQueuedAssessments('learner-b'))[0].requestId).toBe('attempt-b');
  });

  it('keeps offline assessment answers queued after a failed submit', async () => {
    await store.queueAssessment(assessment('learner-a', 'attempt-failed'));

    expect(await syncQueuedAssessments('learner-a', store, async () => { throw new Error('network lost'); }, () => true)).toBe(0);
    expect((await store.listQueuedAssessments('learner-a'))[0].requestId).toBe('attempt-failed');
  });

  it('removes only the assessment answers for a removed course', async () => {
    await store.saveCourse('learner-a', course('course-1'));
    await store.saveCourse('learner-a', course('course-2'));
    await store.queueAssessment(assessment('learner-a', 'attempt-1', 'course-1'));
    await store.queueAssessment(assessment('learner-a', 'attempt-2', 'course-2'));

    await store.removeCourse('learner-a', 'course-1');

    expect((await store.listQueuedAssessments('learner-a')).map((attempt) => attempt.requestId)).toEqual(['attempt-2']);
    expect(await store.getCourse('learner-a', 'course-2')).toBeDefined();
  });

  it('upgrades an existing version-one database without losing saved courses', async () => {
    const name = `starburst-offline-v1-${databaseNumber++}`;
    const oldRequest = indexedDB.open(name, 1);
    oldRequest.onupgradeneeded = () => {
      const db = oldRequest.result;
      const courses = db.createObjectStore('downloaded-courses', { keyPath: 'key' });
      courses.createIndex('ownerId', 'ownerId');
      const progressStore = db.createObjectStore('pending-progress', { keyPath: 'key' });
      progressStore.createIndex('ownerId', 'ownerId');
    };
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => {
      oldRequest.onsuccess = () => resolve(oldRequest.result);
      oldRequest.onerror = () => reject(oldRequest.error);
    });
    const oldTx = oldDb.transaction('downloaded-courses', 'readwrite');
    oldTx.objectStore('downloaded-courses').put({ key: 'learner-a:kept', ownerId: 'learner-a', courseId: 'kept', course: course('kept'), downloadedAt: 1 });
    await new Promise<void>((resolve, reject) => {
      oldTx.oncomplete = () => resolve();
      oldTx.onerror = () => reject(oldTx.error);
    });
    oldDb.close();

    const upgradedStore = createIndexedDbOfflineLearningStore(indexedDB, name);
    expect((await upgradedStore.listCourses('learner-a')).map((item) => item.course.id)).toEqual(['kept']);
    await upgradedStore.queueAssessment(assessment('learner-a', 'new-attempt', 'kept'));
    expect(await upgradedStore.listQueuedAssessments('learner-a')).toHaveLength(1);
  });
});
