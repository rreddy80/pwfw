# Architecture

## Layers

```
tests/*.spec.ts
      |
      v
src/fixtures/index.ts      <- specs only ever import { test, expect } from here
      |
      +-- api.fixtures.ts    -> apiHttpClient, usersController, postsController, authController
      +-- auth.fixtures.ts   -> authMode, apiTokens, authenticatedPage,
      |                         authenticatedApiHttpClient   (extends api.fixtures)
      +-- page.fixtures.ts   -> loginPage, landingPage
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

Add a new resource by copying `posts.controller.ts`: extend `BaseController`, define a zod
schema for the response shape, write one method per operation, wire it into
`api.fixtures.ts`.

## Why fixtures are split into three files

Each file owns one concern (API surface, auth, page objects) and is independently testable
in isolation. `auth.fixtures.ts` builds on top of `api.fixtures.ts`'s `test` (it needs
`authController`), while `page.fixtures.ts` only needs the built-in `page` fixture, so it
stays independent. `src/fixtures/index.ts` combines them with `mergeTests` — the
Playwright-provided way to combine fixture sets that were built as separate `test.extend()`
chains — so specs get one flat, fully-typed `test` object regardless of which file a given
fixture actually lives in.

## Why the API layer and the E2E layer share one fixture module

A spec that needs to seed data before checking the UI (or vice versa) is just a normal test
with both an API controller fixture and `authenticatedPage`/page-object fixtures in its
argument list — no separate "integration test" mechanism needed. `playwright.config.ts`
still splits `tests/api` and `tests/e2e` into separate Playwright _projects_ purely so they
can be run (and reported on) independently in CI — that's a reporting/scheduling boundary,
not a code boundary.

## Data flow for a typical UI spec

1. `authenticatedPage` fixture resolves (`authMode` defaults to `'api'`, see
   `docs/AUTH.md`) — the test body starts already on an authenticated page.
2. The spec optionally seeds data first via a controller fixture (`postsController.createPost(...)`).
3. The spec drives `authenticatedPage` and asserts through page objects
   (`landingPage.expectLoaded()`, etc.), or asserts on `authenticatedPage` locators directly
   for one-off checks that don't warrant a dedicated page object method.
