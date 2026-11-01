import { createElement } from 'react';
import { canAccess, type AccessContext } from './access-runtime';
import type { NavigationItem, ShellDefinition, ViewDefinition, ViewContext } from './types';

export type ResolvedView = { view: ViewDefinition; params: Readonly<Record<string, string>> };
export type AccessControlledView =
  | { status: 'allowed'; view: ViewDefinition; params: Readonly<Record<string, string>> }
  | { status: 'denied'; view: ViewDefinition; redirectTo?: string };

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

/** Resolves a route and its client-side visibility rule. Server APIs must enforce the same permission. */
export function resolveAccessibleView(
  views: readonly ViewDefinition[],
  pathname: string,
  access: AccessContext,
  unauthorizedPath?: string,
): AccessControlledView | undefined {
  const resolved = resolveView(views, pathname);
  if (!resolved) return undefined;
  if (!canAccess(resolved.view.access, access)) {
    return { status: 'denied', view: resolved.view, redirectTo: unauthorizedPath };
  }
  return { status: 'allowed', ...resolved };
}

/** Filters shell navigation using the same client-side rules as views and actions. */
export function getAccessibleNavigation(shell: ShellDefinition, access: AccessContext): readonly NavigationItem[] {
  return shell.navigation.filter((item) => canAccess(item.access, access));
}

/** Produces the React element for a resolved view and its typed route context. */
export function renderView(view: ViewDefinition, context: ViewContext) {
  return createElement(view.component, { context });
}

function decodeSegment(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
