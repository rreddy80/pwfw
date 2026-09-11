import type { Page } from '@playwright/test';
import { env } from '../config/env.js';
import { KeycloakLoginPage } from '../pages/keycloak-login.page.js';
import { LandingPage } from '../pages/landing.page.js';
import { test as authTest } from './auth.fixtures.js';

export interface PageFixtures {
  loginPage: KeycloakLoginPage;
  landingPage: LandingPage;
  /** A page already sitting on the authenticated landing screen, reached via `authMode`. */
  authenticatedPage: Page;
}

/**
 * Builds on `auth.fixtures.ts` (needs `authMode`/`testUser`/`resolveSsoSession` for
 * `authenticatedPage`). `loginPage`/`landingPage` are for specs that drive (and assert on)
 * the login flow itself — e.g. `tests/e2e/ui-login.e2e.spec.ts`. Specs that just want to
 * *be* logged in already should use `authenticatedPage` instead.
 */
export const test = authTest.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new KeycloakLoginPage(page));
  },

  landingPage: async ({ page }, use) => {
    await use(new LandingPage(page));
  },

  authenticatedPage: async ({ browser, authMode, testUser, resolveSsoSession }, use) => {
    if (authMode === 'ui') {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(env.BASE_URL);
      await new KeycloakLoginPage(page).login(testUser.username, testUser.password);
      await new LandingPage(page).expectLoaded();
      await use(page);
      await context.close();
      return;
    }

    const storageState = await resolveSsoSession(testUser);
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto(env.BASE_URL);
    await new LandingPage(page).expectLoaded();
    await use(page);
    await context.close();
  },
});
