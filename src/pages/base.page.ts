import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Every page object commits to `expectLoaded()`: an explicit, asserted checkpoint that the
 * page actually rendered before a test (or fixture) proceeds to act on it. This is what
 * lets the login flow "confirm the page before navigating on" — callers await
 * `expectLoaded()` between each hop (Keycloak form -> app landing) instead of hoping a
 * click landed somewhere sane.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Assert the defining element(s) of this page are visible. Throws (via `expect`) if not. */
  abstract expectLoaded(): Promise<void>;
}

export { expect };
