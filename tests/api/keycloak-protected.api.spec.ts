import { test, expect } from '../../src/fixtures/index.js';
import { env } from '../../src/config/env.js';

/**
 * Proves the "log in via API, use the token against the backend" path actually works —
 * `tests/api/users.api.spec.ts` and `posts.api.spec.ts` never exercise this because their
 * demo target (JSONPlaceholder) doesn't check auth at all, so there's nothing there to prove.
 * Keycloak's own `/userinfo` endpoint is a real protected endpoint (401s without a valid
 * token), which is what makes this a genuine test rather than a no-op.
 */
test.describe('Using a Keycloak token against a protected endpoint', () => {
  test('a token from passwordGrant authenticates a real protected call', async ({
    authController,
  }) => {
    const tokens = await authController.passwordGrant(env.TEST_USERNAME, env.TEST_PASSWORD);

    const userInfo = await authController.getUserInfo(tokens.accessToken);

    expect(userInfo.preferred_username).toBe(env.TEST_USERNAME);
  });

  test('the same endpoint rejects a request with no valid token', async ({ authController }) => {
    const result = await authController.getUserInfoRaw('not-a-real-token');

    expect(result.status).toBe(401);
  });
});
