import type { LearningRecord } from './learning-queries';

export type SavedCourseProgress = {
  sceneIndex: number;
  positionSeconds: number;
  completed: boolean;
};

export type DownloadedLesson = {
  ownerId: string;
  course: LearningRecord;
  downloadedAt: number;
  progress?: SavedCourseProgress;
};

export type PendingCourseProgress = SavedCourseProgress & {
  ownerId: string;
  courseId: string;
  updatedAt: number;
};

export interface OfflineLearningStore {
  saveCourse(ownerId: string, course: LearningRecord, progress?: SavedCourseProgress): Promise<void>;
  listCourses(ownerId: string): Promise<DownloadedLesson[]>;
  getCourse(ownerId: string, courseId: string): Promise<DownloadedLesson | undefined>;
  removeCourse(ownerId: string, courseId: string): Promise<void>;
  updateCourseProgress(ownerId: string, courseId: string, progress: SavedCourseProgress): Promise<void>;
  getSavedProgress(ownerId: string, courseId: string): Promise<SavedCourseProgress | undefined>;
  queueProgress(progress: PendingCourseProgress): Promise<void>;
  listQueuedProgress(ownerId: string): Promise<PendingCourseProgress[]>;
  removeQueuedProgress(ownerId: string, courseId: string): Promise<void>;
  clearUser(ownerId: string): Promise<void>;
}

const DATABASE_VERSION = 1;
const COURSE_STORE = 'downloaded-courses';
const PROGRESS_STORE = 'pending-progress';

export function createIndexedDbOfflineLearningStore(
  factory: IDBFactory = indexedDB,
  databaseName = 'starburst-offline-learning',
): OfflineLearningStore {
  let databasePromise: Promise<IDBDatabase> | undefined;

  function database(): Promise<IDBDatabase> {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = factory.open(databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          const courses = db.createObjectStore(COURSE_STORE, { keyPath: 'key' });
          courses.createIndex('ownerId', 'ownerId', { unique: false });
          const progress = db.createObjectStore(PROGRESS_STORE, { keyPath: 'key' });
          progress.createIndex('ownerId', 'ownerId', { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open offline learning storage'));
        request.onblocked = () => reject(new Error('Offline learning storage is blocked by another tab'));
      });
    }
    return databasePromise;
  }

  return {
    async saveCourse(ownerId, course, progress) {
      const db = await database();
      const tx = db.transaction(COURSE_STORE, 'readwrite');
      tx.objectStore(COURSE_STORE).put({
        key: courseKey(ownerId, course.id),
        ownerId,
        courseId: course.id,
        course,
        downloadedAt: Date.now(),
        progress,
      } satisfies DownloadedLesson & { key: string; courseId: string });
      await transactionDone(tx);
    },

    async listCourses(ownerId) {
      const db = await database();
      const tx = db.transaction(COURSE_STORE, 'readonly');
      const request = tx.objectStore(COURSE_STORE).index('ownerId').getAll(ownerId);
      const rows = await requestResult<(DownloadedLesson & { courseId: string })[]>(request);
      await transactionDone(tx);
      return rows.sort((a, b) => b.downloadedAt - a.downloadedAt);
    },

    async getCourse(ownerId, courseId) {
      const db = await database();
      const tx = db.transaction(COURSE_STORE, 'readonly');
      const row = await requestResult<DownloadedLesson | undefined>(tx.objectStore(COURSE_STORE).get(courseKey(ownerId, courseId)));
      await transactionDone(tx);
      return row;
    },

    async removeCourse(ownerId, courseId) {
      const db = await database();
      const tx = db.transaction([COURSE_STORE, PROGRESS_STORE], 'readwrite');
      tx.objectStore(COURSE_STORE).delete(courseKey(ownerId, courseId));
      tx.objectStore(PROGRESS_STORE).delete(courseKey(ownerId, courseId));
      await transactionDone(tx);
    },

    async updateCourseProgress(ownerId, courseId, progress) {
      const db = await database();
      const tx = db.transaction(COURSE_STORE, 'readwrite');
      const store = tx.objectStore(COURSE_STORE);
      const key = courseKey(ownerId, courseId);
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) store.put({ ...request.result, progress });
      };
      await transactionDone(tx);
    },

    async getSavedProgress(ownerId, courseId) {
      const db = await database();
      const tx = db.transaction([COURSE_STORE, PROGRESS_STORE], 'readonly');
      const pendingRequest = tx.objectStore(PROGRESS_STORE).get(courseKey(ownerId, courseId));
      const courseRequest = tx.objectStore(COURSE_STORE).get(courseKey(ownerId, courseId));
      const [pending, course] = await Promise.all([
        requestResult<PendingCourseProgress | undefined>(pendingRequest),
        requestResult<DownloadedLesson | undefined>(courseRequest),
      ]);
      await transactionDone(tx);
      return pending ? progressValue(pending) : course?.progress;
    },

    async queueProgress(progress) {
      const db = await database();
      const tx = db.transaction(PROGRESS_STORE, 'readwrite');
      tx.objectStore(PROGRESS_STORE).put({ ...progress, key: courseKey(progress.ownerId, progress.courseId) });
      await transactionDone(tx);
    },

    async listQueuedProgress(ownerId) {
      const db = await database();
      const tx = db.transaction(PROGRESS_STORE, 'readonly');
      const rows = await requestResult<PendingCourseProgress[]>(tx.objectStore(PROGRESS_STORE).index('ownerId').getAll(ownerId));
      await transactionDone(tx);
      return rows.sort((a, b) => a.updatedAt - b.updatedAt);
    },

    async removeQueuedProgress(ownerId, courseId) {
      const db = await database();
      const tx = db.transaction(PROGRESS_STORE, 'readwrite');
      tx.objectStore(PROGRESS_STORE).delete(courseKey(ownerId, courseId));
      await transactionDone(tx);
    },

    async clearUser(ownerId) {
      const db = await database();
      const tx = db.transaction([COURSE_STORE, PROGRESS_STORE], 'readwrite');
      for (const storeName of [COURSE_STORE, PROGRESS_STORE]) {
        const store = tx.objectStore(storeName);
        const keys = await requestResult<IDBValidKey[]>(store.index('ownerId').getAllKeys(ownerId));
        for (const key of keys) store.delete(key);
      }
      await transactionDone(tx);
    },
  };
}

export const offlineLearningStore = createIndexedDbOfflineLearningStore();

export async function persistProgressOfflineFirst(
  progress: PendingCourseProgress,
  store: OfflineLearningStore = offlineLearningStore,
  saveOnline: (progress: PendingCourseProgress) => Promise<void>,
  isOnline = browserIsOnline,
): Promise<{ queued: boolean }> {
  if (isOnline()) {
    try {
      await saveOnline(progress);
      await store.removeQueuedProgress(progress.ownerId, progress.courseId);
      await store.updateCourseProgress(progress.ownerId, progress.courseId, progressValue(progress));
      return { queued: false };
    } catch {
      // A failed request may be caused by a dropped connection. Keep the latest position locally.
    }
  }
  await store.queueProgress({ ...progress, updatedAt: Date.now() });
  await store.updateCourseProgress(progress.ownerId, progress.courseId, progressValue(progress));
  return { queued: true };
}

export async function syncQueuedProgress(
  ownerId: string,
  store: OfflineLearningStore = offlineLearningStore,
  saveOnline: (progress: PendingCourseProgress) => Promise<void>,
  isOnline = browserIsOnline,
): Promise<number> {
  if (!isOnline()) return 0;
  const pending = await store.listQueuedProgress(ownerId);
  let synced = 0;
  for (const progress of pending) {
    try {
      await saveOnline(progress);
      await store.updateCourseProgress(ownerId, progress.courseId, progressValue(progress));
      await store.removeQueuedProgress(ownerId, progress.courseId);
      synced += 1;
    } catch {
      // Leave failed positions queued for the next reconnect attempt.
    }
  }
  return synced;
}

export function courseKey(ownerId: string, courseId: string): string {
  return `${ownerId}:${courseId}`;
}

function progressValue(progress: SavedCourseProgress): SavedCourseProgress {
  return { sceneIndex: progress.sceneIndex, positionSeconds: progress.positionSeconds, completed: progress.completed };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline learning storage request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline learning storage transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline learning storage transaction was aborted'));
  });
}

function browserIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}
