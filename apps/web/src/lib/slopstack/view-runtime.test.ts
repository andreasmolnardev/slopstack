import { describe, expect, it } from 'vitest';
import { resolveView } from './view-runtime';
import { defineView } from './define';

const views = [
  defineView({ id: 'tasks', path: '/tasks', label: 'Tasks', component: () => null }),
  defineView({ id: 'task', path: '/tasks/:taskId', label: 'Task', component: () => null }),
  defineView({ id: 'files', path: '/files/*', label: 'Files', component: () => null }),
];

describe('view route resolver', () => {
  it('matches static and parameterized paths with decoded params', () => {
    expect(resolveView(views, '/tasks/')?.view.id).toBe('tasks');
    expect(resolveView(views, '/tasks/a%20b')).toMatchObject({ view: { id: 'task' }, params: { taskId: 'a b' } });
  });

  it('captures wildcard paths and rejects unmatched routes', () => {
    expect(resolveView(views, '/files/2026/receipt.pdf')?.params['*']).toBe('2026/receipt.pdf');
    expect(resolveView(views, '/not-found')).toBeUndefined();
    expect(resolveView(views, '/tasks/extra/segment')).toBeUndefined();
  });
});
