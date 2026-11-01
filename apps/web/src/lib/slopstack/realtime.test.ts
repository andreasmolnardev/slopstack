import { describe, expect, it } from 'vitest';
import type PocketBase from 'pocketbase';
import { subscribePocketBaseResource } from './react-query';

describe('PocketBase realtime resources', () => {
  it('forwards record changes and unsubscribes when disposed', async () => {
    let callback: ((event: { action: string; record: unknown }) => void) | undefined;
    let unsubscribed = 0;
    const pb = {
      collection: () => ({
        subscribe: async (_topic: string, listener: (event: { action: string; record: unknown }) => void) => {
          callback = listener;
          return () => { unsubscribed += 1; };
        },
        unsubscribe: async () => { unsubscribed += 1; },
      }),
    } as unknown as PocketBase;
    const events: Array<{ action: string; record: unknown }> = [];
    const stop = subscribePocketBaseResource(pb, 'tasks', (event) => events.push(event));
    await Promise.resolve();
    callback?.({ action: 'update', record: { id: 'task-1' } });
    expect(events).toEqual([{ action: 'update', record: { id: 'task-1' } }]);
    stop();
    expect(unsubscribed).toBe(1);
  });

  it('cleans up a subscription that resolves after its owner unmounts', async () => {
    let resolveSubscription: ((stop: () => void) => void) | undefined;
    let cancelled = 0;
    const pb = {
      collection: () => ({
        subscribe: () => new Promise((resolve) => { resolveSubscription = resolve; }),
        unsubscribe: async () => undefined,
      }),
    } as unknown as PocketBase;
    const stop = subscribePocketBaseResource(pb, 'tasks', () => undefined);
    stop();
    resolveSubscription?.(() => { cancelled += 1; });
    await Promise.resolve();
    expect(cancelled).toBe(1);
  });
});
