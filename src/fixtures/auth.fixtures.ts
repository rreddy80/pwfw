import type { Page } from '@playwright/test';
import { env } from '../config/env.js';
import { HttpClient } from '../api/http-client.js';
import { KeycloakAuth, type BrowserSessionResult } from '../auth/keycloak-auth.js';
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

type SsoSession = BrowserSessionResult['storageState'];

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
  /** Password-grant bearer tokens — for backends that authenticate via `Authorization: Bearer`. */
  apiTokens: AuthTokens;
  /** A page already sitting on the authenticated landing screen, reached via `authMode`. */
  authenticatedPage: Page;
  /**
   * An `HttpClient` (bound to `API_BASE_URL`) carrying the *same* Keycloak session cookies
   * `authenticatedPage` uses — for backends that authenticate via session cookie rather than
   * a bearer token (common when the frontend and backend sit behind one gateway/origin).
   * Both come from the same underlying login, so a test using both is genuinely one identity,
   * not two independently-obtained ones. See `docs/AUTH.md`.
   */
  authenticatedApiHttpClient: HttpClient;
}

export interface AuthWorkerFixtures {
  /**
   * Worker-scoped: given a `TestUser`, returns Keycloak's SSO session (cookies + tokens) for
   * that user — running the real login dance only the first time a given username is asked
   * for in this worker (memoized in-memory by username; kept alive for the worker's whole
   * lifetime via this closure) and returning the cached session immediately after that. Two
   * tests in this worker asking for the *same* user share one in-flight login instead of
   * racing to do it twice; different users get separate entries and never block each other.
   *
   * Purely in-memory, no disk cache: a Playwright worker is one Node process for its whole
   * lifetime, so memoizing in a closure already gets the "once per worker" benefit that
   * matters. A different worker (a separate process) redoing the same user's login once is a
   * small, bounded cost — not worth trading for a file on disk with its own path to explain,
   * a cross-process write race to guard against, and a cache to go stale.
   */
  resolveSsoSession: (testUser: TestUser) => Promise<SsoSession>;
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

  resolveSsoSession: [
    async ({ playwright }, use) => {
      const inFlight = new Map<string, Promise<SsoSession>>();

      const resolve = (testUser: TestUser): Promise<SsoSession> => {
        const cacheKey = testUser.username;
        const existing = inFlight.get(cacheKey);
        if (existing) return existing;

        const promise = (async () => {
          const request = await playwright.request.newContext();
          const keycloakAuth = new KeycloakAuth(request);
          const { storageState } = await keycloakAuth.loginForBrowserSession(
            testUser.username,
            testUser.password,
            env.BASE_URL,
          );
          await request.dispose();
          return storageState;
        })();

        inFlight.set(cacheKey, promise);
        return promise;
      };

      await use(resolve);
    },
    { scope: 'worker' },
  ],

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

  authenticatedApiHttpClient: async ({ playwright, testUser, resolveSsoSession }, use) => {
    const storageState = await resolveSsoSession(testUser);
    const context = await playwright.request.newContext({
      baseURL: env.API_BASE_URL,
      storageState,
    });
    await use(new HttpClient(context));
    await context.dispose();
  },
});
