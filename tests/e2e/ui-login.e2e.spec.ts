import { test, expect } from '../../src/fixtures/index.js';
import { env } from '../../src/config/env.js';

/**
 * Drives the real Keycloak login form end to end. Each hop is asserted before moving on:
 * the app redirects to Keycloak -> we confirm the Keycloak form actually rendered -> submit
 * -> we confirm the app's landing page actually rendered, before the test calls it done.
 *
 * This is the spec to extend if you need to assert something about the login *flow* itself
 * (validation errors, MFA step, redirect behavior). For specs that just need to already be
 * logged in, use `authenticatedPage` (see `api-mode-login.e2e.spec.ts`) — it's faster and
 * doesn't re-exercise the form on every test.
 */
test.describe('Keycloak UI login', () => {
  test('logs in through the Keycloak form and reaches the landing page', async ({
    page,
    loginPage,
    landingPage,
  }) => {
    await page.goto(env.BASE_URL);

    // Confirm we were actually redirected to Keycloak before typing anything.
    await loginPage.expectLoaded();
    await loginPage.login(env.TEST_USERNAME, env.TEST_PASSWORD);

    // Confirm the app's landing page rendered before asserting anything about it.
    await landingPage.expectLoaded();
    await landingPage.expectAuthenticatedAs(env.TEST_USERNAME);
  });

  test('shows an error for bad credentials without leaving the login page', async ({
    page,
    loginPage,
  }) => {
    await page.goto(env.BASE_URL);
    await loginPage.expectLoaded();

    await loginPage.login(env.TEST_USERNAME, 'wrong-password');

    await expect(loginPage.errorMessage).toBeVisible();
  });
});
