# Playwright Framework

TypeScript + Playwright framework for two kinds of tests against one codebase:

- **API tests** — REST backend testing through a controller abstraction (`src/api/`).
- **E2E tests** — a React UI secured by Keycloak, either driving the real login form or
  skipping straight to an authenticated session (`src/auth/`, `src/pages/`).

Both share one fixture surface (`src/fixtures/index.ts`), so a spec that seeds data via the
API and then verifies it in the UI is a single, ordinary Playwright test.

## Quick start

```bash
npm install
npx playwright install chromium

cp .env.example .env   # defaults already point at the demo targets below
```

Every controller — API or UI — authenticates via a real Keycloak session by default (see
`docs/AUTH.md`), so both suites need the included demo Keycloak running:

```bash
npm run keycloak:up                 # starts Keycloak on :8080 with the demo realm imported
```

**API tests** — Keycloak is all they need (they hit the public JSONPlaceholder API, not the
sample app, so no browser/UI dependency):

```bash
npm run test:api
```

**E2E tests** — additionally need the tiny sample React app:

```bash
cd sample-app && npm install && npm run dev &   # starts the sample app on :5679
cd ..
npm run test:e2e
```

Demo credentials (seeded by `keycloak/realm-export.json`): `testuser` / `Passw0rd!`.

> The docker-compose stack and `sample-app/` exist only to make this repo's own E2E specs
> runnable out of the box. Point `.env` at your real app / Keycloak realm instead once
> you're building your own tests — see `docs/AUTH.md`.

Other useful commands: `npm run report` (open the last HTML report), `npm run lint`,
`npm run typecheck`, `npm run notify:teams -- <report.json> [report2.json ...]`.

## Layout

```
src/config/       env loading + validation, Keycloak endpoint URLs
src/api/          HttpClient + BaseController + one controller per REST resource
src/auth/         Keycloak auth: password grant, and the SSO-cookie "skip the UI" trick
src/pages/        Page objects for the UI layer (Keycloak login page, app landing page)
src/fixtures/     test.extend() composition — the only thing specs import from
src/helpers/      logger, faker-based data factory
src/notifications/  Adaptive Card builder for Teams
scripts/          notify-teams.ts — CLI run at the end of CI

tests/api/        API specs
tests/e2e/        UI E2E specs

docker-compose.yml, keycloak/   local Keycloak for the demo
sample-app/                     minimal React+Keycloak app for the demo E2E specs
.drone.yml                      CI pipeline
docs/                           ARCHITECTURE.md, AUTH.md, CI.md
```

See `docs/ARCHITECTURE.md` for how the pieces fit together, `docs/AUTH.md` for the two
Keycloak login modes and why they're implemented the way they are, and `docs/CI.md` for the
Drone pipeline and Teams notification setup.

## Adding your own tests

- **New API resource**: add a controller in `src/api/` extending `BaseController` (copy
  `posts.controller.ts`), wire it into `src/fixtures/api.fixtures.ts`, write specs under
  `tests/api/`.
- **New UI page**: add a page object in `src/pages/` extending `BasePage` (implement
  `expectLoaded()`), wire it into `src/fixtures/page.fixtures.ts`, write specs under
  `tests/e2e/`.
- **Point at your real app**: update `.env` (`BASE_URL`, `API_BASE_URL`,
  `KEYCLOAK_BASE_URL`/`KEYCLOAK_REALM`/`KEYCLOAK_CLIENT_ID`) and the locators in
  `src/pages/keycloak-login.page.ts` / `landing.page.ts` if your Keycloak theme or app
  markup differs from the demo.
