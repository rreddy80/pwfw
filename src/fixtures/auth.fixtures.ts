import type { Page } from '@playwright/test';
import { env } from '../config/env.js';
import { KeycloakAuth } from '../auth/keycloak-auth.js';
import { readStorageStateCachePath, writeStorageStateCache } from '../auth/storage-state.js';
import { KeycloakLoginPage } from '../pages/keycloak-login.page.js';
import { LandingPage } from '../pages/landing.page.js';
import type { AuthTokens } from '../api/types.js';
import { test as apiTest } from './api.fixtures.js';

export type AuthMode = 'ui' | 'api';

/** Just the two things a login needs — no registry, no lookup-by-name; pass whichever
 * credentials a test should run as straight into `test.use({ testUser: {...} })`. */
export interface TestUser {
  username: string;
  password: string;
}

export interface AuthFixtures {
  /**
   * `test.use({ authMode: 'ui' })` to drive the real Keycloak login form; defaults to
   * `'api'`, which reaches the landing page via the SSO-cookie trick with no visible form.
   */
  authMode: AuthMode;
  /**
   * Which identity to authenticate as. Defaults to `TEST_USERNAME`/`TEST_PASSWORD`; override
   * per spec/file with `test.use({ testUser: { username, password } })` to run as a
   * different, independent user — each distinct username gets its own cache entry below
   * (keyed purely on `testUser.username`), so different users never share a session.
   */
  testUser: TestUser;
  /** Password-grant tokens for pure API-testing specs — no browser involved at all. */
  apiTokens: AuthTokens;
  /** A page already sitting on the authenticated landing screen, reached via `authMode`. */
  authenticatedPage: Page;
}

export interface AuthWorkerFixtures {
  /**
   * Worker-scoped: given a `TestUser`, returns a cached SSO-cookie `storageState` file path
   * for that user, running the Keycloak login dance only the first time a given user is
   * asked for in this worker (memoized by username in-memory) and reusing the on-disk cache
   * across workers otherwise. Different users get different cache entries and never
   * contend with each other; the *same* user requested concurrently from two tests in this
   * worker shares one in-flight login promise rather than logging in twice.
   */
  resolveSsoStorageStatePath: (testUser: TestUser) => Promise<string>;
}

/**
 * Builds on `api.fixtures.ts` (needs `authController` for `apiTokens`). Merged with the page
 * object fixtures in `src/fixtures/index.ts` — specs should import from there, not here.
 */
export const test = apiTest.extend<AuthFixtures, AuthWorkerFixtures>({
  authMode: ['api', { option: true }],
  testUser: [{ username: env.TEST_USERNAME, password: env.TEST_PASSWORD }, { option: true }],

  apiTokens: async ({ authController, testUser }, use) => {
    await use(await authController.passwordGrant(testUser.username, testUser.password));
  },

  resolveSsoStorageStatePath: [
    async ({ playwright }, use) => {
      // Per-worker memoization cache, keyed by username — kept alive for the worker's whole
      // lifetime via this closure. Two tests in this worker asking for the *same* user share
      // one in-flight login instead of racing to do it twice; different users get separate
      // entries and never block on each other.
      const inFlight = new Map<string, Promise<string>>();

      const resolve = (testUser: TestUser): Promise<string> => {
        const cacheKey = testUser.username;
        const existing = inFlight.get(cacheKey);
        if (existing) return existing;

        const promise = (async () => {
          const cached = await readStorageStateCachePath(cacheKey);
          if (cached) return cached;

          const request = await playwright.request.newContext();
          const keycloakAuth = new KeycloakAuth(request);
          await keycloakAuth.loginForBrowserSession(
            testUser.username,
            testUser.password,
            env.BASE_URL,
          );
          const path = await writeStorageStateCache(cacheKey, await request.storageState());
          await request.dispose();
          return path;
        })();

        inFlight.set(cacheKey, promise);
        return promise;
      };

      await use(resolve);
    },
    { scope: 'worker' },
  ],

  authenticatedPage: async ({ browser, authMode, testUser, resolveSsoStorageStatePath }, use) => {
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

    const storageStatePath = await resolveSsoStorageStatePath(testUser);
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();
    await page.goto(env.BASE_URL);
    await new LandingPage(page).expectLoaded();
    await use(page);
    await context.close();
  },
});
