import { useEffect } from 'react';
import { client as generatedClient } from './generated/client.gen';
import { saveCourseProgress } from './generated/sdk.gen';
import { offlineLearningStore, syncQueuedProgress, type PendingCourseProgress } from './offline-learning';
import { pb } from './pocketbase';

export async function saveCourseProgressOnline(progress: PendingCourseProgress): Promise<void> {
  const result = await saveCourseProgress({
    client: generatedClient,
    path: { id: progress.courseId },
    body: {
      scene_index: progress.sceneIndex,
      position_seconds: progress.positionSeconds,
      completed: progress.completed,
    },
  });
  if (result.error) throw new Error('Could not sync course progress');
}

export function useOfflineProgressSync(): void {
  useEffect(() => {
    let previousUserId = pb.authStore.model?.id;
    const sync = () => {
      const ownerId = pb.authStore.model?.id;
      if (ownerId && navigator.onLine) {
        void syncQueuedProgress(ownerId, offlineLearningStore, saveCourseProgressOnline).catch(() => undefined);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') sync();
    };
    const unsubscribe = pb.authStore.onChange((token, model) => {
      const nextUserId = model?.id;
      if (previousUserId && previousUserId !== nextUserId) {
        void offlineLearningStore.clearUser(previousUserId).catch(() => undefined);
      }
      previousUserId = nextUserId;
      if (token && nextUserId) sync();
    });
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibilityChange);
    sync();
    return () => {
      unsubscribe();
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
