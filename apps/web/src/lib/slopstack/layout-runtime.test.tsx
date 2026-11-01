import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineLayout } from './define';
import { renderLayout } from './layout-runtime';

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

  it('rejects missing, unknown, incompatible, and repeated slot contents', () => {
    expect(() => renderLayout(layout)).toThrow('requires slot "main"');
    expect(() => renderLayout(layout, { aside: { kind: 'component', content: 'aside' }, main: { kind: 'view', content: 'main' } })).toThrow('no slot "aside"');
    expect(() => renderLayout(layout, { main: { kind: 'action', content: 'action' } })).toThrow('does not accept action');
    expect(() => renderLayout(layout, { main: [{ kind: 'view', content: 'one' }, { kind: 'resource', content: 'two' }] })).toThrow('accepts one item');
  });
});
