import * as React from 'react';
import { useSyncExternalStore } from 'react';
import type { AccessContext } from '@slopstack/core';
import type { ApplicationDefinition, ViewContext } from '@slopstack/core';
import { resolveApplicationRoute, type ApplicationRouteResult } from './view-runtime.js';
import { resolveFileRoute, type FileRoute, type FileRouteModule, type FileRouteResolution } from './file-router.js';

export type NavigationLocation = { pathname: string; search: URLSearchParams };
export type NavigationAdapter = {
  getLocation: () => NavigationLocation;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  back?: () => void;
  subscribe: (listener: () => void) => () => void;
};

export type RouterSnapshot = NavigationLocation & { route: ApplicationRouteResult };

export type SlopstackRouter = {
  getSnapshot: () => RouterSnapshot;
  subscribe: (listener: () => void) => () => void;
  navigate: ViewContext['navigate'];
  back: () => void;
  setAccess: (access: AccessContext) => void;
  dispose: () => void;
};

const BASE_URL = 'http://slopstack.local';

export function createMemoryNavigationAdapter(initial = '/') : NavigationAdapter {
  let history = [new URL(initial, BASE_URL)];
  let index = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    getLocation: () => ({ pathname: history[index].pathname, search: new URLSearchParams(history[index].search) }),
    navigate(to, options) {
      const target = new URL(to, BASE_URL);
      if (options?.replace) history[index] = target;
      else {
        history = [...history.slice(0, index + 1), target];
        index += 1;
      }
      emit();
    },
    back() {
      if (index <= 0) return;
      index -= 1;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createBrowserNavigationAdapter(): NavigationAdapter {
  return {
    getLocation: () => ({ pathname: window.location.pathname, search: new URLSearchParams(window.location.search) }),
    navigate(to, options) {
      if (options?.replace) window.history.replaceState(window.history.state, '', to);
      else window.history.pushState(window.history.state, '', to);
      window.dispatchEvent(new Event('slopstack:navigate'));
    },
    back: () => window.history.back(),
    subscribe(listener) {
      window.addEventListener('popstate', listener);
      window.addEventListener('slopstack:navigate', listener);
      return () => {
        window.removeEventListener('popstate', listener);
        window.removeEventListener('slopstack:navigate', listener);
      };
    },
  };
}

export function createSlopstackRouter(
  application: ApplicationDefinition,
  access: AccessContext,
  adapter: NavigationAdapter = createBrowserNavigationAdapter(),
): SlopstackRouter {
  const listeners = new Set<() => void>();
  let currentAccess = access;
  const navigate: ViewContext['navigate'] = (to, options) => adapter.navigate(to, options);
  const createSnapshot = (): RouterSnapshot => {
    const location = adapter.getLocation();
    return {
      ...location,
      route: resolveApplicationRoute(application, {
        ...location,
        access: currentAccess,
        navigate,
      }),
    };
  };
  let snapshot = createSnapshot();
  const publish = () => {
    snapshot = createSnapshot();
    listeners.forEach((listener) => listener());
  };
  const stop = adapter.subscribe(publish);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate,
    back: () => adapter.back?.(),
    setAccess(nextAccess) {
      currentAccess = nextAccess;
      publish();
    },
    dispose() {
      stop();
      listeners.clear();
    },
  };
}

export function useSlopstackRouter(router: SlopstackRouter) {
  return useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot);
}

export type FileRouterSnapshot = NavigationLocation & { route: FileRouteResolution };
export type FileBasedRouter = Omit<SlopstackRouter, 'getSnapshot' | 'setAccess'> & { getSnapshot: () => FileRouterSnapshot };

export function useFileBasedRouter(router: FileBasedRouter) {
  return useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot);
}

export function FileRouteLink(props: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  router: FileBasedRouter;
}) {
  const { to, router, onClick, ...anchorProps } = props;
  return React.createElement('a', {
    ...anchorProps,
    href: to,
    onClick(event: React.MouseEvent<HTMLAnchorElement>) {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.currentTarget.target;
      if (target && target !== '_self' || anchorProps.download !== undefined) return;
      const url = new URL(to, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      router.navigate(`${url.pathname}${url.search}${url.hash}`);
    },
  });
}

/** File-based counterpart to createSlopstackRouter; shares browser history and
 * subscription semantics with the manifest router. */
export function createFileBasedRouter(
  routes: readonly FileRoute[],
  modules: Readonly<Record<string, FileRouteModule>>,
  adapter: NavigationAdapter = createBrowserNavigationAdapter(),
): FileBasedRouter {
  const listeners = new Set<() => void>();
  const navigate: ViewContext['navigate'] = (to, options) => adapter.navigate(to, options);
  const createSnapshot = (): FileRouterSnapshot => {
    const location = adapter.getLocation();
    return { ...location, route: resolveFileRoute(routes, modules, { ...location, navigate }) };
  };
  let snapshot = createSnapshot();
  const publish = () => { snapshot = createSnapshot(); listeners.forEach((listener) => listener()); };
  const stop = adapter.subscribe(publish);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    navigate,
    back: () => adapter.back?.(),
    dispose() { stop(); listeners.clear(); },
  };
}
