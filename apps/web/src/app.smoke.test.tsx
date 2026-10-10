import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { App } from './app';
import { pb } from './api/pocketbase';

function renderApp(path: string) {
  window.history.replaceState({}, '', path);
  return render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <App />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  pb.authStore.clear();
});

describe('App', () => {
  it('shows the not found page for an unknown route', async () => {
    renderApp('/definitely-not-a-route');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('renders the sign in form on /auth/login when signed out', async () => {
    renderApp('/auth/login');

    expect(await screen.findByText('Welcome back')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('renders the admin sign in form on /auth/admin', async () => {
    renderApp('/auth/admin');

    expect(await screen.findByText('Admin sign in')).toBeTruthy();
  });

  it('redirects a signed out visitor from a workspace route to sign in', async () => {
    renderApp('/app/tasks');

    expect(await screen.findByText('Welcome back')).toBeTruthy();
    expect(window.location.pathname).toBe('/auth/login');
  });
});