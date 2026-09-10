import type { Locator, Page } from '@playwright/test';
import { BasePage, expect } from './base.page.js';

/**
 * The authenticated landing screen of the sample app (see `sample-app/src/App.tsx`).
 * Point the locators at your real app's equivalent "I am definitely logged in" markers.
 */
export class LandingPage extends BasePage {
  readonly welcomeHeading: Locator;
  readonly usernameLabel: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomeHeading = page.getByRole('heading', { name: /welcome/i });
    this.usernameLabel = page.getByTestId('authenticated-username');
    this.logoutButton = page.getByRole('button', { name: /log ?out/i });
  }

  async expectLoaded(): Promise<void> {
    await expect(
      this.welcomeHeading,
      'expected the authenticated landing page to render',
    ).toBeVisible();
    await expect(this.logoutButton).toBeVisible();
  }

  async expectAuthenticatedAs(username: string): Promise<void> {
    await expect(this.usernameLabel).toHaveText(username);
  }

  /**
   * Clicks "Log out", which calls Keycloak's real end-session endpoint — this invalidates
   * the underlying SSO session server-side, not just the local browser context. Safe to call
   * from a test using its own fresh login (`test.use({ authMode: 'ui' })`, or any user not
   * shared with other concurrently-running tests). Do NOT call this on a page reached via
   * the default API-mode `authenticatedPage` unless you're certain no other test running in
   * parallel is relying on that same user's cached SSO session — see `docs/AUTH.md`.
   */
  async logout(): Promise<void> {
    await this.logoutButton.click();
  }
}
