import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineLayout } from './define';
import { renderLayout, renderShell } from './layout-runtime';

const layout = defineLayout({
  id: 'detail',
  label: 'Detail',
  slots: [
    { id: 'header', accepts: ['component', 'action'] },
    { id: 'main', accepts: ['view', 'resource'], required: true },
  ],
  component: ({ slots }) => createElement('main', null, slots.header, slots.main),
});

describe('layout runtime', () => {
  it('renders slot content in the layout', () => {
    const result = renderLayout(layout, { main: { kind: 'view', content: createElement('h1', null, 'Tasks') } });
    expect(renderToStaticMarkup(result)).toContain('<h1>Tasks</h1>');
  });

  it('keeps shell-owned persistent regions alongside route content', () => {
    const shell = {
      id: 'workspace', label: 'Workspace', navigation: [],
      component: ({ children }: { children: ReactNode }) => createElement('div', null, children),
      persistentRegions: [{ id: 'player', label: 'Player', component: () => createElement('aside', null, 'Now playing') }],
    };
    const result = renderShell(shell, createElement('h1', null, 'Route content'));
    expect(renderToStaticMarkup(result)).toContain('Now playing');
    expect(renderToStaticMarkup(result)).toContain('Route content');
  });

  it('rejects missing, unknown, incompatible, and repeated slot contents', () => {
    expect(() => renderLayout(layout)).toThrow('requires slot "main"');
    expect(() => renderLayout(layout, { aside: { kind: 'component', content: 'aside' }, main: { kind: 'view', content: 'main' } })).toThrow('no slot "aside"');
    expect(() => renderLayout(layout, { main: { kind: 'action', content: 'action' } })).toThrow('does not accept action');
    expect(() => renderLayout(layout, { main: [{ kind: 'view', content: 'one' }, { kind: 'resource', content: 'two' }] })).toThrow('accepts one item');
  });
});
