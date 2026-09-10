import { test as base } from '@playwright/test';
import { KeycloakLoginPage } from '../pages/keycloak-login.page.js';
import { LandingPage } from '../pages/landing.page.js';

export interface PageFixtures {
  loginPage: KeycloakLoginPage;
  landingPage: LandingPage;
}

/**
 * Page-object fixtures bound to the default `page` fixture. Use these for specs that drive
 * (and assert on) the login flow itself — e.g. `tests/e2e/ui-login.e2e.spec.ts`. Specs that
 * just want to *be* logged in already should use `authenticatedPage` from `auth.fixtures.ts`.
 */
export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new KeycloakLoginPage(page));
  },

  landingPage: async ({ page }, use) => {
    await use(new LandingPage(page));
  },
});
