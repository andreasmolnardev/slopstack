import type { ComponentLike, ViewContext } from '@slopstack/core';

/** A convention-based route module. Route paths are derived from app/routes file names. */
export type FileRouteModule = {
  default: ComponentLike<{ context: ViewContext; children?: unknown }>;
  layout?: ComponentLike<{ context: ViewContext; children?: unknown }>;
  loading?: ComponentLike<{ context: ViewContext }>;
  error?: ComponentLike<{ context: ViewContext; error: Error; reset: () => void }>;
  notFound?: ComponentLike<{ context: ViewContext }>;
};

export type FileRoute = {
  id: string;
  path: string;
  segments: readonly string[];
  module: FileRouteModule;
  layouts: readonly ComponentLike<{ context: ViewContext; children?: unknown }>[];
};

/** Turn route file paths into route records. `(group)` folders are URL-transparent;
 * `[id]` is a named segment and `[...slug]` is a catch-all. */
export function createFileRoutes(modules: Readonly<Record<string, FileRouteModule>>): FileRoute[] {
  return Object.entries(modules)
    .filter(([file]) => /\/page\.[jt]sx?$/.test(file))
    .map(([file, module]) => {
      const routePath = file.replace(/^.*?routes\//, '').replace(/\/page\.[jt]sx?$/, '');
      const raw = routePath.split('/').filter(Boolean);
      const segments = raw.filter((segment) => !/^\(.*\)$/.test(segment));
      const path = `/${segments.map((segment) => segment.startsWith('[') && segment.endsWith(']')
        ? segment.startsWith('[...') ? '*' : `:${segment.slice(1, -1)}`
        : segment).join('/')}`;
      const layouts = Object.entries(modules)
        .filter(([layoutFile, layoutModule]) => layoutModule.layout && file.startsWith(layoutFile.slice(0, layoutFile.lastIndexOf('/') + 1)))
        .sort(([a], [b]) => a.length - b.length)
        .map(([, layoutModule]) => layoutModule.layout!);
      return { id: routePath || 'index', path, segments, module, layouts };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function matchFileRoute(routes: readonly FileRoute[], pathname: string): { route: FileRoute; params: Record<string, string> } | undefined {
  const target = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const part = route.segments[index];
      if (part.startsWith('[...')) {
        params[part.slice(4, -1)] = target.slice(index).map(decode).join('/');
        break;
      }
      if (target[index] === undefined) { matched = false; break; }
      if (part.startsWith('[') && part.endsWith(']')) params[part.slice(1, -1)] = decode(target[index]);
      else if (part !== target[index]) { matched = false; break; }
    }
    if (matched && (route.segments.some((part) => part.startsWith('[...')) || target.length === route.segments.length)) return { route, params };
  }
}

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
