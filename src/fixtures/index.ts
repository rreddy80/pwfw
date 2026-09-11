import { mergeTests } from '@playwright/test';
import { test as apiTest } from './api.fixtures.js';
import { test as pageTest } from './page.fixtures.js';

/**
 * The single entry point every spec should import `{ test, expect }` from. `api.fixtures.ts`
 * and `page.fixtures.ts` each independently extend the shared foundation in
 * `auth.fixtures.ts` (authMode, testUser, authController, apiTokens, resolveSsoSession) —
 * `mergeTests` combines their two chains into one flat, fully-typed `test`. See
 * `docs/ARCHITECTURE.md` for why auth sits underneath both rather than being bolted onto
 * either one.
 */
export const test = mergeTests(apiTest, pageTest);
export { expect } from '@playwright/test';
