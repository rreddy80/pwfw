import { mergeTests } from '@playwright/test';
import { test as authTest } from './auth.fixtures.js';
import { test as pageTest } from './page.fixtures.js';

/**
 * The single entry point every spec should import `{ test, expect }` from. It merges:
 *  - `api.fixtures.ts`  -> apiHttpClient, usersController, postsController, authController
 *  - `auth.fixtures.ts` -> authMode, apiTokens, authenticatedPage
 *  - `page.fixtures.ts` -> loginPage, landingPage
 *
 * (`authTest` already includes everything from `api.fixtures.ts`, since it extends that
 * file's `test` rather than the bare Playwright `test` — see `auth.fixtures.ts`.)
 */
export const test = mergeTests(authTest, pageTest);
export { expect } from '@playwright/test';
