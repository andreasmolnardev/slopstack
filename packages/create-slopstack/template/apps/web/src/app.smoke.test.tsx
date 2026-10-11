import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app';
import { pb } from './api/pocketbase';

const generatedApi = vi.hoisted(() => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
}));

vi.mock('@/api/generated', () => generatedApi);

function renderApp(path: string) {
  window.history.replaceState({}, '', path);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <App />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function signIn() {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  pb.authStore.save(`header.${payload}.signature`, {
    id: 'user-1',
    collectionId: 'users-collection',
    collectionName: 'users',
    email: 'test@example.com',
  });
}

afterEach(() => {
  cleanup();
  pb.authStore.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  generatedApi.listTodos.mockResolvedValue({ data: [] });
  generatedApi.createTodo.mockResolvedValue({ data: {} });
  generatedApi.updateTodo.mockResolvedValue({ data: {} });
  generatedApi.deleteTodo.mockResolvedValue({ data: undefined });
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

  it('loads owner todos and sends completion changes through the generated client', async () => {
    signIn();
    generatedApi.listTodos.mockResolvedValue({
      data: [
        {
          id: 'todo-1',
          title: 'Write tests',
          completed: false,
          created: '2026-10-11 10:00:00.000Z',
          updated: '2026-10-11 10:00:00.000Z',
        },
      ],
    });

    renderApp('/app/tasks');

    expect(await screen.findByText('Write tests')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write tests' }));

    await vi.waitFor(() =>
      expect(generatedApi.updateTodo).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'todo-1' },
          body: { completed: true },
          throwOnError: true,
        }),
      ),
    );
    await vi.waitFor(() => expect(generatedApi.listTodos).toHaveBeenCalledTimes(2));
  });

  it('shows an empty state and creates a todo with the generated client', async () => {
    signIn();
    renderApp('/app/tasks');

    expect(await screen.findByText('No todos yet. Add one to get started.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Plan release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await vi.waitFor(() =>
      expect(generatedApi.createTodo).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ title: 'Plan release' }),
          throwOnError: true,
        }),
      ),
    );
  });

  it('shows a retryable error when the todo API fails', async () => {
    signIn();
    generatedApi.listTodos.mockRejectedValue(new Error('API unavailable'));

    renderApp('/app/tasks');

    expect((await screen.findByRole('alert')).textContent).toContain('API unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
