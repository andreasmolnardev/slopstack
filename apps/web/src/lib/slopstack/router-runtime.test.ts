import { describe, expect, it, vi } from 'vitest';
import { createMemoryNavigationAdapter, createSlopstackRouter } from './router-runtime';
import { defineView } from './define';
import type { ApplicationDefinition } from './types';

const application: ApplicationDefinition = {
  id: 'router-test',
  name: 'Router test',
  authentication: { provider: 'custom', enforcement: 'server', routes: { unauthorized: '/login' } },
  views: [
    { ...defineView({ id: 'tasks', path: '/tasks', label: 'Tasks', component: () => null }), access: { authenticated: true } },
    defineView({ id: 'task', path: '/tasks/:taskId', label: 'Task', component: () => null }),
  ],
};

describe('Slopstack router', () => {
  it('tracks browser-like navigation and composes access-aware route results', () => {
    const adapter = createMemoryNavigationAdapter('/tasks');
    const router = createSlopstackRouter(application, { authenticated: false }, adapter);
    expect(router.getSnapshot().route).toMatchObject({ status: 'denied', redirectTo: '/login' });

    const listener = vi.fn();
    router.subscribe(listener);
    router.setAccess({ authenticated: true });
    expect(router.getSnapshot().route.status).toBe('rendered');
    router.navigate('/tasks/task-5?tab=activity');
    expect(router.getSnapshot()).toMatchObject({
      pathname: '/tasks/task-5',
      search: new URLSearchParams('tab=activity'),
      route: { status: 'rendered', params: { taskId: 'task-5' } },
    });
    router.back();
    expect(router.getSnapshot().pathname).toBe('/tasks');
    expect(listener).toHaveBeenCalled();
    router.dispose();
  });

  it('supports replacing the current history entry', () => {
    const adapter = createMemoryNavigationAdapter('/tasks');
    const router = createSlopstackRouter(application, { authenticated: true }, adapter);
    router.navigate('/tasks/one');
    router.navigate('/tasks/two', { replace: true });
    router.back();
    expect(router.getSnapshot().pathname).toBe('/tasks');
  });
});
