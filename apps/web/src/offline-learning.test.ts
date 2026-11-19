import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createIndexedDbOfflineLearningStore,
  persistProgressOfflineFirst,
  syncQueuedProgress,
  type OfflineLearningStore,
  type PendingCourseProgress,
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

describe('offline learning storage', () => {
  it('keeps downloads separated by owner and removes only the selected owner data', async () => {
    await store.saveCourse('learner-a', course('course-1'));
    await store.saveCourse('learner-b', course('course-1'));
    await store.queueProgress(progress('learner-a', 'course-1', 2));
    await store.queueProgress(progress('learner-b', 'course-1', 4));

    await store.clearUser('learner-a');

    expect(await store.listCourses('learner-a')).toEqual([]);
    expect(await store.listQueuedProgress('learner-a')).toEqual([]);
    expect((await store.listCourses('learner-b')).map((item) => item.course.title)).toEqual(['Course course-1']);
    expect((await store.listQueuedProgress('learner-b'))[0].sceneIndex).toBe(4);
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
});
