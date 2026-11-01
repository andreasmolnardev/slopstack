import { describe, expect, it, vi } from 'vitest';
import { runAction } from './action-runtime.js';
import type { ActionDefinition } from './types.js';

const runtime = (overrides: Partial<Parameters<typeof runAction>[2]> = {}) => ({
  navigate: () => undefined,
  authorize: async () => true,
  confirm: async () => true,
  notify: vi.fn(),
  ...overrides,
});

describe('action runtime', () => {
  it('checks access, confirms, executes, and reports declared success', async () => {
    const execute = vi.fn(async ({ input }: { input: number }) => input * 2);
    const action: ActionDefinition<number, number> = {
      id: 'double', label: 'Double', access: { permission: 'math:run' },
      confirm: { title: 'Run action?' }, messages: { success: 'Done' }, execute,
    };
    const authorize = vi.fn(async () => true);
    const confirm = vi.fn(async () => true);
    const notify = vi.fn();
    const result = await runAction(action, 4, runtime({ authorize, confirm, notify }));

    expect(result).toEqual({ status: 'completed', value: 8 });
    expect(authorize).toHaveBeenCalledWith({ permission: 'math:run' });
    expect(confirm).toHaveBeenCalledWith({ title: 'Run action?' });
    expect(execute).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({ title: 'Done', type: 'success' });
  });

  it('does not run an action when access is denied or confirmation is cancelled', async () => {
    const execute = vi.fn();
    const action: ActionDefinition<void> = {
      id: 'delete', label: 'Delete', confirm: { title: 'Delete?' }, execute,
    };
    const notify = vi.fn();
    await expect(runAction(action, undefined, runtime({ authorize: async () => false, notify }))).resolves.toEqual({ status: 'denied' });
    await expect(runAction(action, undefined, runtime({ confirm: async () => false }))).resolves.toEqual({ status: 'cancelled' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('notifies with the action error and rethrows it', async () => {
    const failure = new Error('Network is offline');
    const action: ActionDefinition<void> = {
      id: 'save', label: 'Save', messages: { error: 'Save failed' }, execute: () => { throw failure; },
    };
    const notify = vi.fn();
    await expect(runAction(action, undefined, runtime({ notify }))).rejects.toBe(failure);
    expect(notify).toHaveBeenCalledWith({ title: 'Save failed', description: 'Network is offline', type: 'error' });
  });
});
