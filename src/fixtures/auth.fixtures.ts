import { test as base } from '@playwright/test';
import { env } from '../config/env.js';
import { AuthController } from '../api/auth.controller.js';
import { HttpClient } from '../api/http-client.js';
import { KeycloakAuth, type BrowserSessionResult } from '../auth/keycloak-auth.js';
import type { AuthTokens } from '../api/types.js';

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
   * `test.use({ authMode: 'ui' })` to drive the real Keycloak login form (see
   * `page.fixtures.ts`'s `authenticatedPage`); defaults to `'api'`, which reaches an
   * authenticated session via the SSO-cookie trick with no visible form.
   */
  authMode: AuthMode;
  /**
   * Which identity to authenticate as. Defaults to `TEST_USERNAME`/`TEST_PASSWORD`; override
   * per spec/file with `test.use({ testUser: { username, password } })` to run as a
   * different, independent user — each distinct username gets its own cache entry below
   * (keyed purely on `testUser.username`), so different users never share a session.
   */
  testUser: TestUser;
  /** Talks to Keycloak's token endpoint via absolute URLs — no baseURL needed. */
  authController: AuthController;
  /** Password-grant bearer tokens — for the rare backend that authenticates via `Authorization: Bearer` instead of the session cookie every other fixture here uses. */
  apiTokens: AuthTokens;
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
 * The shared foundation — `api.fixtures.ts` and `page.fixtures.ts` both extend this `test`,
 * not the other way around. Every real microservice controller (wired in `api.fixtures.ts`)
 * and `authenticatedPage` (wired in `page.fixtures.ts`) come from the *same*
 * `resolveSsoSession` call for a given user, so one login serves both layers — neither file
 * needs to know the other exists. See `docs/AUTH.md` and `docs/ARCHITECTURE.md`.
 */
export const test = base.extend<AuthFixtures, AuthWorkerFixtures>({
  authMode: ['api', { option: true }],
  testUser: [{ username: env.TEST_USERNAME, password: env.TEST_PASSWORD }, { option: true }],

  // The plain built-in `request` fixture is fine here — `AuthController` always calls
  // Keycloak with fully-qualified URLs (`keycloakConfig.tokenUrl`, etc.), so there's no
  // relative path that would need a `baseURL` to resolve against.
  authController: async ({ request }, use) => {
    await use(new AuthController(new HttpClient(request)));
  },

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
});
