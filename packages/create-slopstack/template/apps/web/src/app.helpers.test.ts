import { describe, expect, it } from 'vitest';
import { formatDate, getUserInitials, getUserName, normalizePath, priorityClass, routeForPath } from './app';

describe('normalizePath', () => {
  it('strips trailing slashes and keeps the root', () => {
    expect(normalizePath('/app/tasks/')).toBe('/app/tasks');
    expect(normalizePath('/app//')).toBe('/app');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});

describe('routeForPath', () => {
  it('maps workspace paths to app views', () => {
    expect(routeForPath('/app')).toEqual({ kind: 'app', view: 'overview' });
    expect(routeForPath('/app/tasks')).toEqual({ kind: 'app', view: 'tasks' });
    expect(routeForPath('/app/schedule/')).toEqual({ kind: 'app', view: 'schedule' });
    expect(routeForPath('/app/analytics')).toEqual({ kind: 'app', view: 'analytics' });
    expect(routeForPath('/app/components')).toEqual({ kind: 'app', view: 'components' });
    expect(routeForPath('/app/icons')).toEqual({ kind: 'app', view: 'icons' });
    expect(routeForPath('/app/profile')).toEqual({ kind: 'app', view: 'profile' });
  });

  it('maps admin paths to admin sections', () => {
    expect(routeForPath('/admin')).toEqual({ kind: 'admin', section: 'users' });
    expect(routeForPath('/admin/users')).toEqual({ kind: 'admin', section: 'users' });
    expect(routeForPath('/admin/sso')).toEqual({ kind: 'admin', section: 'sso' });
  });

  it('maps auth paths to auth modes', () => {
    expect(routeForPath('/auth/login')).toEqual({ kind: 'auth', mode: 'login' });
    expect(routeForPath('/auth/register')).toEqual({ kind: 'auth', mode: 'register' });
    expect(routeForPath('/auth/forgot-password')).toEqual({ kind: 'auth', mode: 'forgot-password' });
    expect(routeForPath('/auth/admin')).toEqual({ kind: 'auth', mode: 'admin-login' });
  });

  it('falls back to not-found for unknown paths', () => {
    expect(routeForPath('/nope')).toEqual({ kind: 'not-found' });
    expect(routeForPath('/app/unknown')).toEqual({ kind: 'not-found' });
  });
});

describe('getUserName', () => {
  it('prefers display_name, then name, then the email local part', () => {
    expect(getUserName({ display_name: 'Ada Lovelace', name: 'ada', email: 'ada@example.com' })).toBe(
      'Ada Lovelace',
    );
    expect(getUserName({ name: 'Grace', email: 'grace@example.com' })).toBe('Grace');
    expect(getUserName({ email: 'linus@example.com' })).toBe('linus');
  });

  it('returns an empty string for missing or non-object identities', () => {
    expect(getUserName(undefined)).toBe('');
    expect(getUserName(null)).toBe('');
    expect(getUserName('nope')).toBe('');
    expect(getUserName({ display_name: '   ' })).toBe('');
  });
});

describe('getUserInitials', () => {
  it('uses the first and last word for multi-word names', () => {
    expect(getUserInitials('Ada Lovelace')).toBe('AL');
    expect(getUserInitials('  jean   luc  picard ')).toBe('JP');
  });

  it('falls back to the first two characters of a single word', () => {
    expect(getUserInitials('linus')).toBe('LI');
    expect(getUserInitials('')).toBe('');
  });
});

describe('formatDate', () => {
  it('formats an ISO date without timezone drift', () => {
    expect(formatDate('2026-08-25')).toBe('Aug 25');
  });
});

describe('priorityClass', () => {
  it('gives each priority a distinct tone', () => {
    const high = priorityClass('High');
    const medium = priorityClass('Medium');
    const low = priorityClass('Low');
    expect(new Set([high, medium, low]).size).toBe(3);
    expect(high).toContain('rose');
    expect(medium).toContain('amber');
    expect(low).toContain('sky');
  });
});