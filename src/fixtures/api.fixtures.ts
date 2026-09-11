import { env } from '../config/env.js';
import { HttpClient } from '../api/http-client.js';
import { PostsController } from '../api/posts.controller.js';
import { UsersController } from '../api/users.controller.js';
import { test as authTest } from './auth.fixtures.js';

export interface ApiFixtures {
  /**
   * Bound to `API_BASE_URL` and pre-loaded with the same Keycloak session cookies
   * `authenticatedPage` uses — every controller below (and every one you add for your own
   * services behind the same gateway) is authenticated from its very first call, with no
   * per-controller wiring decision. A dedicated context, not the ambient per-project
   * `request` fixture — that one's `baseURL` is the *browser* app under test (`BASE_URL`)
   * when this runs inside an E2E spec, which would resolve relative controller paths
   * (`/orders`, `/posts`) against the wrong host.
   */
  apiHttpClient: HttpClient;
  usersController: UsersController;
  postsController: PostsController;
}

/**
 * Builds on `auth.fixtures.ts` (needs `testUser`/`resolveSsoSession` for `apiHttpClient`).
 * One client, shared by every controller — add a new microservice by writing a
 * `XController extends BaseController` (see `posts.controller.ts` for the template) and
 * wiring it here the same way `postsController` is wired below. All of them sit behind the
 * one gateway `API_BASE_URL` points at, so one login and one client serves all of them.
 */
export const test = authTest.extend<ApiFixtures>({
  apiHttpClient: async ({ playwright, testUser, resolveSsoSession }, use) => {
    const storageState = await resolveSsoSession(testUser);
    const context = await playwright.request.newContext({
      baseURL: env.API_BASE_URL,
      storageState,
    });
    await use(new HttpClient(context));
    await context.dispose();
  },

  usersController: async ({ apiHttpClient }, use) => {
    await use(new UsersController(apiHttpClient));
  },

  postsController: async ({ apiHttpClient }, use) => {
    await use(new PostsController(apiHttpClient));
  },
});
