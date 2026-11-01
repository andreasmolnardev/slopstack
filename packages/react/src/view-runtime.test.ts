import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAccessibleNavigation, renderView, resolveAccessibleView, resolveApplicationRoute, resolveView } from './view-runtime.js';
import { defineLayout, defineShell, defineView } from '@slopstack/core';

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

  it('applies view access and supplies the configured sign-in redirect', () => {
    const protectedViews = [defineView({
      id: 'private', path: '/private', label: 'Private',
      access: { authenticated: true }, component: () => null,
    })];
    expect(resolveAccessibleView(protectedViews, '/private', { authenticated: false }, '/login')).toMatchObject({
      status: 'denied', redirectTo: '/login',
    });
    expect(resolveAccessibleView(protectedViews, '/private', { authenticated: true })?.status).toBe('allowed');
  });

  it('filters navigation and renders a view with its route context', () => {
    const view = defineView({ id: 'tasks', path: '/tasks', label: 'Tasks', component: () => null });
    const shell = defineShell({
      id: 'main', label: 'Main', component: ({ children }) => children,
      navigation: [
        { id: 'tasks', label: 'Tasks', view: 'tasks' },
        { id: 'admin', label: 'Admin', view: 'tasks', access: { roles: ['admin'] } },
      ],
    });
    expect(getAccessibleNavigation(shell, { authenticated: true }).map((item) => item.id)).toEqual(['tasks']);
    expect(renderView(view, { params: {}, search: new URLSearchParams('q=hello'), navigate: () => undefined }).props.context.search.get('q')).toBe('hello');
  });

  it('composes a matched view through its layout and shell', () => {
    const application = {
      id: 'example',
      name: 'Example',
      authentication: { provider: 'custom' as const, enforcement: 'server' as const, routes: { unauthorized: '/login' } },
      views: [defineView({
        id: 'task', path: '/tasks/:taskId', label: 'Task', layout: 'page',
        component: ({ context }) => createElement('p', null, 'Task ', context.params.taskId),
      })],
      layouts: [defineLayout({
        id: 'page', label: 'Page', slots: [{ id: 'main', accepts: ['view'] as const, required: true }],
        component: ({ slots }) => createElement('main', null, slots.main),
      })],
      shell: defineShell({
        id: 'shell', label: 'Shell', navigation: [],
        component: ({ children }) => createElement('div', { className: 'shell' }, children),
      }),
    };
    const result = resolveApplicationRoute(application, {
      pathname: '/tasks/task-42',
      search: new URLSearchParams('tab=details'),
      navigate: () => undefined,
      access: { authenticated: true },
    });
    expect(result.status).toBe('rendered');
    if (result.status !== 'rendered') return;
    expect(result.params).toEqual({ taskId: 'task-42' });
    expect(renderToStaticMarkup(result.element)).toContain('<div class="shell"><main><p>Task task-42</p></main></div>');
    expect(resolveApplicationRoute(application, { pathname: '/unknown', navigate: () => undefined, access: { authenticated: true } })).toEqual({ status: 'not-found' });
  });

  it('returns an unauthorized redirect for a protected view', () => {
    const application = {
      id: 'private-app', name: 'Private',
      authentication: { provider: 'custom' as const, enforcement: 'server' as const, routes: { unauthorized: '/sign-in' } },
      views: [defineView({ id: 'private', path: '/private', label: 'Private', access: { authenticated: true }, component: () => null })],
    };
    expect(resolveApplicationRoute(application, { pathname: '/private', navigate: () => undefined, access: { authenticated: false } })).toMatchObject({
      status: 'denied', redirectTo: '/sign-in',
    });
  });
});
