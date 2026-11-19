import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useOfflineProgressSync } from '../api/offline-progress';

export interface RouterContext {
  queryClient: QueryClient;
}

function RoutePending() {
  return <main className="min-h-screen bg-[#0e0621] p-8 text-[#f8f5fc]" aria-live="polite">Loading Starburst…</main>;
}

function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <main className="min-h-screen bg-[#0e0621] p-8 text-[#f8f5fc]">
      <section role="alert" className="mx-auto mt-16 max-w-xl rounded-xl border border-white/10 bg-[#211638] p-6">
        <h1 className="text-xl font-semibold">This page could not load</h1>
        <p className="mt-2 text-sm text-[#b7adcc]">{error instanceof Error ? error.message : 'An unexpected error occurred.'}</p>
        <button className="mt-4 rounded-lg bg-[#6350c8] px-4 py-2" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}

function RouteNotFound() {
  return (
    <main className="min-h-screen bg-[#0e0621] p-8 text-[#f8f5fc]">
      <section className="mx-auto mt-16 max-w-xl rounded-xl border border-white/10 bg-[#211638] p-6">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <a className="mt-4 inline-block text-[#efc778]" href="/">Return to your learning space</a>
      </section>
    </main>
  );
}

function RootLayout() {
  useOfflineProgressSync();
  return <Outlet />;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});
