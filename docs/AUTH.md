# Authentication

Two independent modes. Pick per-spec with `test.use({ authMode: 'ui' | 'api' })`
(`api` is the default).

## UI mode — drive the real Keycloak form

```ts
test('...', async ({ page, loginPage, landingPage }) => {
  await page.goto(env.BASE_URL);
  await loginPage.expectLoaded(); // confirm we're really on the Keycloak form
  await loginPage.login(username, password);
  await landingPage.expectLoaded(); // confirm the app actually rendered before asserting
});
```

Each hop is asserted before the next: the app redirects to Keycloak -> `expectLoaded()`
confirms the login form rendered (not an error page, not a silent-SSO skip) -> credentials
submitted -> `expectLoaded()` confirms the landing page rendered. Use this mode for specs
that test the login flow itself — validation errors, redirect behavior, anything about the
form. It's also available as `authenticatedPage` with `test.use({ authMode: 'ui' })` for
specs that want a real UI login but don't care about the flow itself.

## API mode — skip the form, still get a real authenticated session

This is the "log in via API, keep the tokens/session a UI test needs" mode. There are
**three** tools here, not one — which to reach for depends entirely on how your real backend
authenticates a request. Using the wrong one is a common footgun, worth being explicit about:

### Backend validates a `Authorization: Bearer` token: `AuthController.passwordGrant`

```ts
test('...', async ({ authController, apiHttpClient }) => {
  const tokens = await authController.passwordGrant(env.TEST_USERNAME, env.TEST_PASSWORD);
  apiHttpClient.setAuthToken(tokens.accessToken);
  // ...call the backend directly with a Bearer token, no browser involved
});
```

Or just use the `apiTokens` fixture, which does the same call. Resource Owner Password
Credentials grant against Keycloak's token endpoint — requires the client to have **Direct
Access Grants** enabled (already set on the demo realm's `demo-app` client).

See `tests/api/keycloak-protected.api.spec.ts` for this proven against a real protected
endpoint end to end (get a token, call the backend with it, confirm it's rejected without
one) — the other `tests/api/*` specs target JSONPlaceholder, which doesn't check auth at
all, so they never attach a token; don't take those as the pattern to copy for a real,
Keycloak-protected backend.

### Backend validates the Keycloak session cookie instead (no bearer token at all): `authenticatedApiHttpClient`

Common when the frontend and backend sit behind one gateway/origin and something in front
of the backend checks the same `KEYCLOAK_SESSION`/`KEYCLOAK_IDENTITY` cookies the browser
carries, rather than a JWT. `apiTokens`/`passwordGrant` won't help here — there's no bearer
token in the picture at all. Use the `authenticatedApiHttpClient` fixture instead: an
`HttpClient` pre-loaded with the _same_ Keycloak session cookies `authenticatedPage` uses —
literally the same login, not a second one, so a test using both is one identity throughout.

```ts
test('...', async ({ authenticatedApiHttpClient }) => {
  const ordersController = new OrdersController(authenticatedApiHttpClient);
  const orders = await ordersController.listOrders(); // authenticated via cookie, no token anywhere
});
```

See `tests/e2e/shared-session.e2e.spec.ts` for this proven two ways: the API client's
cookies are recognized by Keycloak as a real, working session (not just present-but-inert),
and its `KEYCLOAK_SESSION` cookie value is byte-for-byte the same one `authenticatedPage`'s
browser context carries.

### If the spec needs a browser page that's already logged into the real app: `authenticatedPage`

**Why you can't just inject a token into `localStorage` and call it done:** most keycloak-js
SPA integrations keep the access/refresh/id tokens in memory, not in `localStorage` or a
cookie the app itself reads. They instead re-derive "am I logged in" on page load by asking
Keycloak (the sample app uses `onLoad: 'login-required'`, which redirects to Keycloak
whenever there's no valid session). Writing a token into storage that nothing on the page
ever reads back does nothing — the app boots, asks Keycloak, and Keycloak has no idea who
you are because the _browser_ never established a session with it.

What actually works: give the browser Keycloak's own SSO session cookie, then let the app's
normal check-sso dance find it. `KeycloakAuth.loginForBrowserSession` (`src/auth/keycloak-auth.ts`)
gets that cookie without a browser page at all:

1. `GET` the authorize endpoint with a real PKCE challenge — the same request the SPA's
   redirect would make.
2. Parse the Keycloak login form's `action` URL out of the HTML and `POST` credentials to
   it directly. Keycloak responds with a 302 back to the app and sets its SSO session
   cookie (`KEYCLOAK_SESSION`, etc.) along the way — that's the part that matters.
3. Exchange the authorization code from that redirect for tokens too, in case the test also
   wants a bearer token (`apiTokens`-style) in the same run.

The resulting `storageState` (Playwright's `APIRequestContext.storageState()`) carries that
cookie. Load it into a fresh `browser.newContext({ storageState })`, navigate to the app,
and its `login-required` redirect to Keycloak finds the existing SSO session and bounces
straight back authenticated — no form rendered, no credentials typed into a page.

`authenticatedPage` and `authenticatedApiHttpClient` (`src/fixtures/auth.fixtures.ts`) both
wrap all of this, and both pull from the same place: `resolveSsoSession`, a worker-scoped
fixture that runs the real login dance only the first time a given username is asked for in
this worker, memoized **in memory** (a `Map` in the fixture's closure — no disk, no `.auth/`
file) for the rest of that worker's run. Each test still gets its own fresh browser
context/API context on top of that cached session, so tests stay isolated from each other
while only paying the Keycloak round trip once per user per worker. A different worker
(separate process) redoing the same user's login once is a small, bounded cost — not worth
trading for a cross-process file cache with its own path to explain and races to guard against.

```ts
test('...', async ({ authenticatedPage }) => {
  // already on the landing page, no login form ever rendered
  await expect(authenticatedPage.getByTestId('authenticated-username')).toHaveText('testuser');
});
```

## Multiple users

`testUser` is a fixture option — just `{ username, password }`, no registry to maintain.
Defaults to `TEST_USERNAME`/`TEST_PASSWORD`; override it per spec/file to run as whichever
other user that spec needs:

```ts
test.use({ testUser: { username: env.TEST_USERNAME_2, password: env.TEST_PASSWORD_2 } });

test('...', async ({ authenticatedPage }) => {
  await expect(authenticatedPage.getByTestId('authenticated-username')).toHaveText('seconduser');
});
```

Wherever the credentials come from — more `.env`/CI-secret pairs (see `.env.example`), a
value read at runtime, whatever — pass them straight in. `resolveSsoSession` keys purely on
`testUser.username`, so any two distinct usernames automatically get their own cache entry
in that worker and never share a session; there's nothing to register or look up by name first.

**The one thing per-user caching doesn't make safe: the _same_ user, used destructively, in
parallel.** The cached SSO session for one user is one real Keycloak session ID shared by
every context that loads it. Two parallel tests reading that session (just navigating,
asserting) are fine — it's the same as opening that user's account in two browser tabs.
Calling `landingPage.logout()` on it is not fine: logout hits Keycloak's real end-session
endpoint and kills that session server-side, which would pull the rug out from under any
other test currently relying on the same cached session. Rule of thumb: a spec that logs a
user out should authenticate that user fresh — `test.use({ authMode: 'ui' })`, or a
dedicated, not-shared identity — rather than going through the cached `authenticatedPage`
default. See `tests/e2e/multi-user.e2e.spec.ts` for both patterns side by side.

## If your app's Keycloak adapter is configured differently

- If your SPA _does_ persist a token your app code reads back (some do, against SPA best
  practice) — you may be able to skip `loginForBrowserSession` entirely and just seed
  `localStorage`/`sessionStorage` via `context.addInitScript` before first navigation.
  Cheaper, but specific to how your app stores it; not attempted here since it isn't
  generically true across keycloak-js setups.
- If your client enforces PKCE with a method other than `S256`, or doesn't use the default
  Keycloak login theme's `#kc-form-login` element id, update
  `src/pages/keycloak-login.page.ts` and the form-parsing regex in `keycloak-auth.ts`
  accordingly — both are the single place each of those assumptions lives.
