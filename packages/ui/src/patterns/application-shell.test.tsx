import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Calendar, Home } from 'lucide-react';
import { ApplicationShell } from './application-shell.js';

describe('application shell', () => {
  it.each(['sidebar', 'rail', 'topbar', 'bottom'] as const)('renders %s navigation', (navigationStyle) => {
    const markup = renderToStaticMarkup(<ApplicationShell
      brand="Example"
      items={[{ id: 'home', label: 'Home', icon: Home }, { id: 'calendar', label: 'Calendar', icon: Calendar }]}
      activeId="home"
      navigationStyle={navigationStyle}
      onNavigate={() => undefined}
      account={<button>Account</button>}
    ><p>Route content</p></ApplicationShell>);
    expect(markup).toContain('Primary navigation');
    expect(markup).toContain('Route content');
    expect(markup).toContain('aria-current="page"');
  });
});
