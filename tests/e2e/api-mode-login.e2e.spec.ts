import { test, expect } from '../../src/fixtures/index.js';
import { env } from '../../src/config/env.js';

/**
 * Same destination as `ui-login.e2e.spec.ts` — an authenticated landing page — reached
 * without ever rendering the Keycloak login form. `authMode` defaults to `'api'`, so
 * `authenticatedPage` here comes from `KeycloakAuth.loginForBrowserSession` establishing
 * Keycloak's SSO cookie over HTTP and handing that session to a fresh browser context.
 *
 * Use this for the bulk of UI specs that need to be logged in but aren't testing login
 * itself — it's one Keycloak round trip per worker instead of one form-fill per test.
 */
test.describe('Keycloak API-mode session', () => {
  test('reaches the landing page with no visible login form', async ({ authenticatedPage }) => {
    // No navigation to the login form anywhere in this test — `authenticatedPage` already
    // landed on an authenticated screen by the time the test body runs.
    await expect(authenticatedPage.getByTestId('authenticated-username')).toHaveText(
      env.TEST_USERNAME,
    );
  });

  test('also exposes raw tokens for mixing in direct API calls', async ({ apiTokens }) => {
    expect(apiTokens.accessToken).toBeTruthy();
    expect(apiTokens.tokenType.toLowerCase()).toBe('bearer');
  });
});
