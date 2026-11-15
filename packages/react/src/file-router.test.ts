import { describe, expect, it } from 'vitest';
import { createFileRoutes, matchFileRoute } from './file-router.js';

const page = () => null;

describe('file routes', () => {
  it('derives nested paths, ignores route groups, and matches params/catch-alls', () => {
    const routes = createFileRoutes({
      '/app/routes/(site)/page.tsx': { default: page },
      '/app/routes/(site)/projects/[projectId]/page.tsx': { default: page },
      '/app/routes/docs/[...slug]/page.tsx': { default: page },
      '/app/routes/layout.tsx': { default: page, layout: page },
    });
    expect(routes.map((route) => route.path)).toEqual(['/', '/docs/*', '/projects/:projectId']);
    expect(matchFileRoute(routes, '/projects/a%20b')?.params).toEqual({ projectId: 'a b' });
    expect(matchFileRoute(routes, '/docs/start/here')?.params).toEqual({ slug: 'start/here' });
    expect(routes[0].layouts).toHaveLength(1);
  });
});
