import { test, expect } from '../../src/fixtures/index.js';
import { env } from '../../src/config/env.js';
import { keycloakConfig } from '../../src/config/keycloak.config.js';

/**
 * Proves `authenticatedApiHttpClient` carries a real, working Keycloak session — for
 * backends that authenticate via session cookie rather than a bearer token (see
 * docs/AUTH.md) — and that it's the exact same session `authenticatedPage` uses, not a
 * second independently-obtained one.
 */
test.describe('One Keycloak login shared between UI and API', () => {
  test('authenticatedApiHttpClient carries a working session, not just a token', async ({
    authenticatedApiHttpClient,
  }) => {
    // Hit Keycloak's own authorize endpoint through the API client's cookie jar. With no
    // session, Keycloak renders the login form (200). With a real, recognized session, it
    // redirects straight back (302) without ever rendering the form — same silent re-auth a
    // browser gets. maxRedirects: 0 so we see that raw status instead of Playwright quietly
    // following it.
    const result = await authenticatedApiHttpClient.get(keycloakConfig.authorizeUrl, {
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

  test('it is the exact same session authenticatedPage uses, not a second login', async ({
    resolveSsoSession,
    testUser,
    authenticatedPage,
  }) => {
    const apiSession = await resolveSsoSession(testUser);
    const apiSessionCookie = apiSession.cookies.find((c) => c.name === 'KEYCLOAK_SESSION');
    expect(apiSessionCookie).toBeDefined();

    const browserCookies = await authenticatedPage.context().cookies();
    const browserSessionCookie = browserCookies.find((c) => c.name === 'KEYCLOAK_SESSION');

    // Same cookie *value* means the same underlying Keycloak session ID — one login, shared.
    expect(browserSessionCookie?.value).toBe(apiSessionCookie?.value);
  });
});
