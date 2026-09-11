# CI (Drone) and Teams notifications

## Pipeline

`.drone.yml`: `install` -> `api-tests` -> `e2e-tests` -> `notify-teams` (the last step runs
`when: status: [success, failure]`, so a failing suite still gets reported).

Steps run in `mcr.microsoft.com/playwright:v1.49.0-jammy`, which ships with browsers
preinstalled — no separate `playwright install --with-deps` step needed. Keep the image tag
in sync with the `@playwright/test` version in `package.json`.

Both `api-tests` and `e2e-tests` point at a real test/staging environment via secrets
(`e2e_base_url`, `keycloak_base_url`, `keycloak_realm`, `keycloak_client_id`,
`keycloak_client_secret`, `test_username`, `test_password`) — `api-tests` needs Keycloak too,
not just `e2e-tests`: `apiHttpClient` authenticates via a real Keycloak session before its
first call (see `docs/AUTH.md`), there's no unauthenticated API path once you've replaced
the demo controllers with your own. Neither step starts the repo's `docker-compose.yml`
Keycloak or `sample-app/`; those are for local development of the framework only.

## Reports

`playwright.config.ts` reads `TEST_REPORT_NAME` to decide where the JSON reporter writes
(`reports/api-results.json`, `reports/e2e-results.json` — see the `test:api`/`test:e2e` npm
scripts). Playwright's JSON reporter already buckets every test into `expected` (passed),
`unexpected` (failed), `flaky`, or `skipped` — a test that failed and then passed on retry
is reported as `flaky`, not `passed`, which is exactly the distinction the Teams summary
wants.

## Teams notification

`scripts/notify-teams.ts` reads one or more of those JSON files, sums the counts, and posts
one **Adaptive Card** (not the legacy Office 365 "Incoming Webhook" `MessageCard` format,
which Microsoft has retired) to `TEAMS_WEBHOOK_URL`.

### Setting up the webhook URL

1. In Microsoft Teams, add a **Workflows** app to the channel you want notifications in.
2. Create a workflow from the template **"When a Teams webhook request is received, post to
   a channel"** (or build a custom one with that trigger).
3. Copy the trigger's HTTP POST URL and store it as the `teams_webhook_url` Drone secret
   (and/or `TEAMS_WEBHOOK_URL` locally).

The workflow trigger accepts a `message` activity with an Adaptive Card attachment — exactly
what `buildTeamsAdaptiveCardPayload` (`src/notifications/adaptive-card.builder.ts`) produces.
If you change the card layout, that function is the only place to edit.

### Local testing without spamming a real channel

```bash
TEAMS_WEBHOOK_URL= npm run notify:teams -- reports/api-results.json
```

With `TEAMS_WEBHOOK_URL` unset, the script logs the summary and exits `0` — it never fails
the build just because notifications aren't configured.
