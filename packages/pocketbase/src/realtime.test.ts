import { describe, expect, it, vi } from 'vitest';
import { subscribePocketBaseResource } from './realtime.js';

describe('PocketBase realtime adapter', () => {
  it('subscribes to the collection and cancels on dispose', async () => {
    const cancel = vi.fn();
    const pb = { collection: () => ({ subscribe: async () => cancel, unsubscribe: vi.fn() }) } as never;
    const dispose = subscribePocketBaseResource(pb, 'widgets', vi.fn());
    await Promise.resolve();
    dispose();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
