import { describe, expect, it, vi } from 'vitest';
import { createBackgroundOperationManager } from './background-operations';

describe('background operation manager', () => {
  it('reports progress and terminal success', async () => {
    const manager = createBackgroundOperationManager();
    const changed = vi.fn();
    manager.subscribe(changed);
    const id = manager.start({
      id: 'export',
      label: 'Export data',
      async run(_input, { reportProgress }) { reportProgress(45, 'Preparing archive'); },
    }, undefined);
    expect(manager.get(id)?.status).toBe('running');
    await vi.waitFor(() => expect(manager.get(id)?.status).toBe('succeeded'));
    expect(manager.get(id)).toMatchObject({ progress: 100, message: 'Preparing archive' });
    expect(changed).toHaveBeenCalled();
  });

  it('cancels active work and removes completed records', async () => {
    const manager = createBackgroundOperationManager();
    const id = manager.start({
      id: 'sync',
      label: 'Sync',
      run: (_input, { signal }) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
    }, undefined);
    expect(manager.cancel(id)).toBe(true);
    expect(manager.get(id)?.status).toBe('cancelled');
    await vi.waitFor(() => expect(manager.remove(id)).toBe(true));
    expect(manager.list()).toEqual([]);
  });

  it('records failures without throwing into the caller', async () => {
    const manager = createBackgroundOperationManager();
    const id = manager.start({ id: 'fail', label: 'Fail', run: async () => { throw new Error('network'); } }, undefined);
    await vi.waitFor(() => expect(manager.get(id)?.status).toBe('failed'));
    expect(manager.get(id)?.error).toEqual(new Error('network'));
  });
});
