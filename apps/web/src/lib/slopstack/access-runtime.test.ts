import { describe, expect, it } from 'vitest';
import { canAccess } from './access-runtime';

describe('access requirements', () => {
  it('allows public features without a session', () => {
    expect(canAccess(undefined, { authenticated: false })).toBe(true);
  });

  it('checks authentication, role membership, and permission callbacks', () => {
    const context = { authenticated: true, roles: ['member', 'owner'], hasPermission: (permission: string) => permission === 'tasks:write' };
    expect(canAccess({ authenticated: true, roles: ['owner'], permission: 'tasks:write' }, context)).toBe(true);
    expect(canAccess({ roles: ['admin'] }, context)).toBe(false);
    expect(canAccess({ permission: 'users:delete' }, context)).toBe(false);
    expect(canAccess({ authenticated: true }, { authenticated: false })).toBe(false);
  });

  it('does not treat client access as server authorization', () => {
    expect(canAccess({ permission: 'tasks:write' }, { authenticated: true })).toBe(false);
  });
});
