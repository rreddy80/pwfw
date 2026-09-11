import { test, expect } from '../../src/fixtures/index.js';

/**
 * The cross-cutting half of the cookie-session proof (see `tests/api/keycloak-cookie-session.api.spec.ts`
 * for the pure API-layer half, which doesn't need a browser at all): confirms `apiHttpClient`
 * and `authenticatedPage` share one Keycloak session, not two independently-obtained ones.
 * Needs `authenticatedPage`, hence living under `tests/e2e/`.
 */
test.describe('One Keycloak login shared between UI and API', () => {
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
