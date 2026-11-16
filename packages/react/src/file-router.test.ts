import { describe, expect, it } from 'vitest';
import { createFileRoutes, matchFileRoute, resolveFileRoute } from './file-router.js';
import { createFileBasedRouter, createMemoryNavigationAdapter } from './router-runtime.js';

const page = () => null;

describe('file routes', () => {
  it('derives nested paths, ignores route groups, and matches params/catch-alls', () => {
    const routes = createFileRoutes({
      '/app/routes/(site)/page.tsx': { default: page },
      '/app/routes/(site)/layout.tsx': { default: page },
      '/app/routes/(site)/projects/[projectId]/page.tsx': { default: page },
      '/app/routes/(site)/projects/[projectId]/loading.tsx': { default: page },
      '/app/routes/(site)/projects/[projectId]/error.tsx': { default: page },
      '/app/routes/docs/[...slug]/page.tsx': { default: page },
      '/app/routes/layout.tsx': { default: page },
      '/app/routes/not-found.tsx': { default: page },
    });
    expect(routes.map((route) => route.path)).toEqual(['/', '/docs/*', '/projects/:projectId']);
    expect(matchFileRoute(routes, '/projects/a%20b')?.params).toEqual({ projectId: 'a b' });
    expect(matchFileRoute(routes, '/docs/start/here')?.params).toEqual({ slug: 'start/here' });
    expect(routes.find((route) => route.path === '/projects/:projectId')?.layouts).toHaveLength(2);
    const resolved = resolveFileRoute(routes, {
      '/app/routes/(site)/projects/[projectId]/page.tsx': { default: page },
      '/app/routes/(site)/projects/[projectId]/loading.tsx': { default: page },
      '/app/routes/(site)/projects/[projectId]/error.tsx': { default: page },
    }, { pathname: '/projects/one', navigate: () => undefined });
    expect(resolved.status).toBe('rendered');
    if (resolved.status === 'rendered') expect(resolved.loading).toBeTruthy();
  });

  it('connects file routes to memory navigation and renders not-found modules', () => {
    const modules = {
      '/app/routes/page.tsx': { default: page },
      '/app/routes/not-found.tsx': { default: page },
    };
    const adapter = createMemoryNavigationAdapter('/missing');
    const router = createFileBasedRouter(createFileRoutes(modules), modules, adapter);
    expect(router.getSnapshot().route.status).toBe('not-found');
    router.navigate('/');
    expect(router.getSnapshot().route.status).toBe('rendered');
    router.back();
    expect(router.getSnapshot().route.status).toBe('not-found');
    router.dispose();
  });

  it('rejects duplicate URL patterns during route discovery', () => {
    expect(() => createFileRoutes({
      '/app/routes/users/[id]/page.tsx': { default: page },
      '/app/routes/users/[name]/page.tsx': { default: page },
    })).toThrow('resolve to the same URL pattern');
  });
});
