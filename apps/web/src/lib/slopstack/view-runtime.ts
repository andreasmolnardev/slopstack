import type { ViewDefinition } from './types';

export type ResolvedView = { view: ViewDefinition; params: Readonly<Record<string, string>> };

function segments(path: string) {
  return path.replace(/\/+$/, '').split('/').filter(Boolean);
}

/** Resolves exact and `:parameter` view paths without binding the app to a router package. */
export function resolveView(views: readonly ViewDefinition[], pathname: string): ResolvedView | undefined {
  const target = segments(pathname);
  for (const view of views) {
    const pattern = segments(view.path);
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const token = pattern[index];
      if (token === '*') {
        params['*'] = target.slice(index).map(decodeSegment).join('/');
        break;
      }
      const segment = target[index];
      if (segment === undefined) { matched = false; break; }
      if (token.startsWith(':')) params[token.slice(1)] = decodeSegment(segment);
      else if (token !== segment) { matched = false; break; }
    }
    if (matched && (pattern.includes('*') || target.length === pattern.length)) return { view, params };
  }
}

function decodeSegment(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
