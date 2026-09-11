# Architecture

## Layers

```
tests/*.spec.ts
      |
      v
src/fixtures/index.ts      <- specs only ever import { test, expect } from here
      |
      +-- api.fixtures.ts    -> apiHttpClient, usersController, postsController,
      |                         + one controller per microservice you add   (extends auth.fixtures)
      +-- page.fixtures.ts   -> loginPage, landingPage, authenticatedPage    (extends auth.fixtures)
             |
             v
      auth.fixtures.ts    -> authMode, testUser, authController, apiTokens, resolveSsoSession
             |
             v
src/api/            src/auth/            src/pages/
BaseController      KeycloakAuth         BasePage
  |                       |               |
  v                       v               v
HttpClient  <--(storageState)--  KeycloakLoginPage, LandingPage
  |
  v
Playwright APIRequestContext
```

`auth.fixtures.ts` is the **foundation**, not an add-on — `api.fixtures.ts` and
`page.fixtures.ts` each independently extend it (`authTest.extend<...>()`), rather than auth
being layered on top of the API fixtures the way it once was. That's what makes
`apiHttpClient` authenticated by default: it's built from `resolveSsoSession`, which lives in
the shared foundation both files already have access to, not from something only `page.fixtures.ts`
could see.

## Why controllers, not raw HTTP calls in specs

`HttpClient` (`src/api/http-client.ts`) is the only code that touches Playwright's
`APIRequestContext` directly — it turns a request into a typed, already-parsed
`ApiResult<T>` and logs it. `BaseController` (`src/api/base.controller.ts`) adds
`request(method, path, schema, opts)`, which makes the request and validates the response
against a zod schema in one step — `result.body` stays `unknown` until `schema.safeParse`
actually confirms it, so there's no path that hands a controller method typed data without
checking it first. (`validate()` is the lower-level piece `request()` is built on; reach for it
directly only when a method also needs the raw status/headers alongside the validated body —
see `AuthController`.) Concrete controllers (`UsersController`, `PostsController`,
`AuthController`) expose one method per business operation, returning DTOs — specs read as
actions on a resource, not as HTTP plumbing, and survive endpoint/payload reshaping without
every spec needing an edit.

Add a new resource — one microservice, one controller — the same way: extend
`BaseController`, define a zod schema for the response shape, write one method per
operation, wire it into `api.fixtures.ts` on top of the shared `apiHttpClient`. It's
authenticated automatically; there's no separate "authenticated" variant to opt into.

## Why `auth.fixtures.ts` sits underneath both `api.fixtures.ts` and `page.fixtures.ts`

The natural-seeming layout — auth fixtures added on top of the API fixtures, since
`apiTokens`/`authController` are "API-ish" — breaks down the moment `apiHttpClient` itself
needs to be authenticated by default: `page.fixtures.ts` would have no way to reach
something defined downstream in a file it doesn't depend on, and `api.fixtures.ts` reaching
_up_ into an auth file that already depends on it would be circular. Putting the
identity/session primitives (`testUser`, `authController`, `apiTokens`, `resolveSsoSession`)
in their own base file that neither `api.fixtures.ts` nor `page.fixtures.ts` needs the other
to see resolves that: both extend the same foundation independently, `mergeTests` in
`index.ts` combines the two resulting chains, and a single `resolveSsoSession` call — cached
per user, per worker — is what both an authenticated controller call and `authenticatedPage`
draw from.

Each file still owns exactly one concern: `auth.fixtures.ts` is identity/session mechanics
only, `api.fixtures.ts` is the REST surface (one client, one controller per microservice,
all behind one gateway `API_BASE_URL`), `page.fixtures.ts` is the browser/UI surface. None of
the three needs to know the internals of the other two.

## Why the API layer and the E2E layer share one fixture module

A spec that needs to seed data before checking the UI (or vice versa) is just a normal test
with both an API controller fixture and `authenticatedPage`/page-object fixtures in its
argument list — no separate "integration test" mechanism needed, and since both draw from
the same `resolveSsoSession` call, it's one identity throughout, not two independently
authenticated ones. `playwright.config.ts` still splits `tests/api` and `tests/e2e` into
separate Playwright _projects_ purely so they can be run (and reported on) independently in
CI — that's a reporting/scheduling boundary, not a code boundary. Note this also means
`tests/api/*` specs now need Keycloak reachable too (every controller call authenticates
first) — see `docs/CI.md`.

## Data flow for a typical UI spec

1. `authenticatedPage` fixture resolves (`authMode` defaults to `'api'`, see
   `docs/AUTH.md`) — the test body starts already on an authenticated page.
2. The spec optionally seeds data first via a controller fixture (`postsController.createPost(...)`)
   — authenticated via the same session `authenticatedPage` is using.
3. The spec drives `authenticatedPage` and asserts through page objects
   (`landingPage.expectLoaded()`, etc.), or asserts on `authenticatedPage` locators directly
   for one-off checks that don't warrant a dedicated page object method.
