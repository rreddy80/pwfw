import { test, expect } from '../../src/fixtures/index.js';
import { env } from '../../src/config/env.js';
import { keycloakConfig } from '../../src/config/keycloak.config.js';

/**
 * The cookie-session counterpart to `keycloak-protected.api.spec.ts`'s bearer-token proof —
 * for backends that authenticate via the Keycloak session cookie instead of an
 * `Authorization: Bearer` header (see docs/AUTH.md). `apiHttpClient` is authenticated by
 * default via cookies from `KeycloakAuth.loginForBrowserSession` (see `api.fixtures.ts`) —
 * no browser involved, no separate "authenticated" client to opt into.
 */
test.describe('Using a Keycloak session cookie against a protected endpoint', () => {
  test('apiHttpClient carries a real, working session — not just a token', async ({
    apiHttpClient,
  }) => {
    // Hit Keycloak's own authorize endpoint through the API client's cookie jar. With no
    // session, Keycloak renders the login form (200). With a real, recognized session, it
    // redirects straight back (302) without ever rendering the form — same silent re-auth a
    // browser gets. maxRedirects: 0 so we see that raw status instead of Playwright quietly
    // following it.
    const result = await apiHttpClient.get(keycloakConfig.authorizeUrl, {
      params: {
        client_id: keycloakConfig.clientId,
        redirect_uri: env.BASE_URL,
        response_type: 'code',
        scope: 'openid',
      },
      maxRedirects: 0,
    });

    expect(result.status).toBe(302);
  });
});
