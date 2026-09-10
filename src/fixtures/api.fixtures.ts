import { test as base } from '@playwright/test';
import { env } from '../config/env.js';
import { AuthController } from '../api/auth.controller.js';
import { HttpClient } from '../api/http-client.js';
import { PostsController } from '../api/posts.controller.js';
import { UsersController } from '../api/users.controller.js';

export interface ApiFixtures {
  /** Low-level client bound to `API_BASE_URL`. Controllers below are the intended surface for specs. */
  apiHttpClient: HttpClient;
  usersController: UsersController;
  postsController: PostsController;
  /** Talks to Keycloak's token endpoint via absolute URLs — see `AuthController`, no baseURL needed. */
  authController: AuthController;
}

/**
 * Base API layer: one `HttpClient` per backend, one controller per resource. Add a new
 * resource by writing a `XController extends BaseController` (see `posts.controller.ts` for
 * the template) and wiring it here the same way `postsController` is wired below.
 */
export const test = base.extend<ApiFixtures>({
  apiHttpClient: async ({ playwright }, use) => {
    // A dedicated context bound to `API_BASE_URL` via Playwright's own `baseURL` option —
    // not the ambient per-project `request` fixture, whose `baseURL` is the *browser* app
    // under test (`BASE_URL`) when this runs inside an E2E spec. This is what lets a UI spec
    // seed data through `postsController` and still have relative paths like `/posts`
    // resolve against the API, not the app.
    const context = await playwright.request.newContext({ baseURL: env.API_BASE_URL });
    await use(new HttpClient(context));
    await context.dispose();
  },

  usersController: async ({ apiHttpClient }, use) => {
    await use(new UsersController(apiHttpClient));
  },

  postsController: async ({ apiHttpClient }, use) => {
    await use(new PostsController(apiHttpClient));
  },

  // The plain built-in `request` fixture is fine here — `AuthController` always calls
  // Keycloak with fully-qualified URLs (`keycloakConfig.tokenUrl`, etc.), so there's no
  // relative path that would need a `baseURL` to resolve against.
  authController: async ({ request }, use) => {
    await use(new AuthController(new HttpClient(request)));
  },
});
