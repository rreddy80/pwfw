import type { Locator, Page } from '@playwright/test';
import { BasePage, expect } from './base.page.js';

/**
 * Keycloak's default login theme. Locators target the standard element IDs Keycloak ships
 * with (`kc-form-login`, `username`, `password`, `kc-login`) — if your realm uses a custom
 * theme, update the locators here; every fixture/spec that logs in via the UI goes through
 * this one class, so that's the only place a theme change needs to land.
 */
export class KeycloakLoginPage extends BasePage {
  readonly form: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.form = page.locator('#kc-form-login');
    this.usernameInput = page.locator('#username');
    this.passwordInput = page.locator('#password');
    this.submitButton = page.locator('#kc-login');
    this.errorMessage = page.locator('#input-error, .alert-error');
  }

  /**
   * Confirms we actually landed on the Keycloak login form (not, say, an app error page or
   * an already-authenticated silent redirect) before any credentials get typed.
   */
  async expectLoaded(): Promise<void> {
    await expect(this.form, 'expected the Keycloak login form to be visible').toBeVisible();
    await expect(this.usernameInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.expectLoaded();
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
