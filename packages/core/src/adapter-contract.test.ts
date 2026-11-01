import { describe, expect, it, vi } from 'vitest';
import { createResourceClient, defineResource } from './index.js';
import type { ResourceAdapter, ResourceRealtimeAdapter } from './index.js';

type Device = { id: string; name: string };
const devices = defineResource<Device, { name: string }, { name?: string }>({
  id: 'devices', label: 'Device', source: { kind: 'endpoint' },
  fields: [{ name: 'name', label: 'Name', kind: 'text' }],
});

describe('external adapter contracts', () => {
  it('accepts app-owned REST adapters and preserves the resource client API', async () => {
    const adapter: ResourceAdapter<Device, { name: string }, { name?: string }> = {
      async list(query) { expect(query?.search).toBe('lamp'); return [{ id: '1', name: 'Lamp' }]; },
      async get(id) { return { id, name: 'Lamp' }; },
      async create(input) { return { id: '2', ...input }; },
      async update(id, input) { return { id, name: input.name ?? 'Lamp' }; },
      async delete() {},
    };
    const client = createResourceClient(devices, adapter);
    await expect(client.list({ search: 'lamp' })).resolves.toEqual({ items: [{ id: '1', name: 'Lamp' }], total: 1 });
    await expect(client.create({ name: 'Desk' })).resolves.toEqual({ id: '2', name: 'Desk' });
  });

  it('allows custom realtime transports to publish typed events and unsubscribe', () => {
    let publish!: (event: { resourceId: string; operation: 'created'; record: Device }) => void;
    const stop = vi.fn();
    const realtime: ResourceRealtimeAdapter<Device> = {
      subscribe(_resourceId, listener) { publish = listener as typeof publish; return stop; },
    };
    const listener = vi.fn();
    const unsubscribe = realtime.subscribe('devices', listener);
    const event = { resourceId: 'devices', operation: 'created' as const, record: { id: '1', name: 'Lamp' } };
    publish(event);
    expect(listener).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
  });
});
