import { test, expect } from '../../src/fixtures/index.js';
import { env } from '../../src/config/env.js';
import { KeycloakLoginPage } from '../../src/pages/keycloak-login.page.js';
import { LandingPage } from '../../src/pages/landing.page.js';

const secondUser = { username: env.TEST_USERNAME_2, password: env.TEST_PASSWORD_2 };

/**
 * Proves the multi-user design actually works end to end: two independently-configured
 * Keycloak users (TEST_USERNAME/TEST_USERNAME_2, see .env.example) each reach their own
 * landing page with no cross-contamination — including when Playwright runs them in
 * parallel — and a user can log out without disturbing anyone else's session.
 */

test.describe('default test user', () => {
  test('reaches their own landing page', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.getByTestId('authenticated-username')).toHaveText(
      env.TEST_USERNAME,
    );
  });
});

test.describe('a second, independently-configured user', () => {
  test.use({ testUser: secondUser });

  test('reaches their own landing page via their own cached SSO session', async ({
    authenticatedPage,
  }) => {
    // `testUser` (an option, see auth.fixtures.ts) is what `authenticatedPage` authenticates
    // as — this test never touches the default user's cached session, and vice versa.
    await expect(authenticatedPage.getByTestId('authenticated-username')).toHaveText(
      secondUser.username,
    );
  });
});

test.describe('logging a user out', () => {
  // Logout is destructive to the underlying Keycloak session — never do this against the
  // default cached `authenticatedPage` some other test might be relying on (see docs/AUTH.md).
  // `authMode: 'ui'` gives this test its own fresh, never-cached login, so its logout can't
  // affect any other test's session for this same user, even one running in parallel.
  test.use({ authMode: 'ui' });

  test('ends the session and redirects back to the Keycloak login form', async ({
    authenticatedPage,
  }) => {
    await new LandingPage(authenticatedPage).logout();
    await new KeycloakLoginPage(authenticatedPage).expectLoaded();
  });
});
