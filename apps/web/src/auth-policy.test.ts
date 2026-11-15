import { describe, expect, it } from 'vitest';
import { enabledSsoProviders } from './auth-policy';

describe('enabledSsoProviders', () => {
  it('hides OAuth providers while PocketBase OAuth is disabled', () => {
    expect(enabledSsoProviders({ oauth2: { enabled: false, providers: [{ name: 'google' }] } })).toEqual([]);
  });

  it('returns all configured providers and their display names', () => {
    expect(enabledSsoProviders({ oauth2: { enabled: true, providers: [{ name: 'microsoft' }, { name: 'oidc2', displayName: 'Authentik' }] } })).toEqual([
      { name: 'microsoft', displayName: undefined },
      { name: 'oidc2', displayName: 'Authentik' },
    ]);
  });
});
