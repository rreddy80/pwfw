/**
 * Single source of truth for environment configuration.
 *
 * Everything the framework reads from `process.env` is validated and typed here so a
 * missing/misspelled var fails fast with a clear message at startup, instead of surfacing
 * as a confusing `undefined` deep inside a fixture or controller.
 *
 * Local runs: populate `.env` (see `.env.example`). CI (Drone): these come from pipeline
 * secrets/env directly, `dotenv` is a no-op if no `.env` file exists.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Application under test (UI) and REST API under test — deliberately NOT defaulted.
  // Unlike KEYCLOAK_BASE_URL (below), these point at real, always-reachable services (the
  // demo app, JSONPlaceholder). A default here means a forgotten env var in CI doesn't fail
  // loudly — it silently runs the suite against the wrong environment and still "passes".
  // Copy .env.example to .env (or set these in CI) before running anything.
  BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),

  // Keycloak (IAM)
  KEYCLOAK_BASE_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().min(1).default('demo'),
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('demo-app'),
  KEYCLOAK_CLIENT_SECRET: z.string().optional().default(''),
  // If your app's redirect_uri is a real backend callback (a gateway/BFF that performs its
  // own code exchange and issues its own session cookies when actually visited, not just
  // Keycloak's) rather than a static page, API-mode login needs to actually GET that URL for
  // those cookies to ever get set — see KeycloakAuth.loginForBrowserSession's
  // `visitRedirectUri` option and docs/AUTH.md. Off by default: turning this on means
  // BASE_URL must be reachable wherever login runs, including api-only test runs.
  KEYCLOAK_VISIT_REDIRECT_URI_ON_LOGIN: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),

  // Test user credentials — the default identity `authenticatedPage`/`apiTokens` use.
  TEST_USERNAME: z.string().min(1).default('testuser'),
  TEST_PASSWORD: z.string().min(1).default('Passw0rd!'),

  // A second identity, used only by tests/e2e/multi-user.e2e.spec.ts to prove per-user
  // session isolation. Add more the same plain way if you need them — pass whichever
  // {username, password} a test needs straight into `test.use({ testUser: {...} })`,
  // there's no registry to maintain.
  TEST_USERNAME_2: z.string().min(1).default('seconduser'),
  TEST_PASSWORD_2: z.string().min(1).default('Passw0rd2!'),

  // Teams notifications (optional — notifier no-ops without it)
  TEAMS_WEBHOOK_URL: z.string().url().optional().or(z.literal('')).default(''),

  // CI metadata (Drone sets these automatically; all optional for local runs)
  DRONE_BUILD_NUMBER: z.string().optional(),
  DRONE_BUILD_LINK: z.string().optional(),
  DRONE_COMMIT_BRANCH: z.string().optional(),
  DRONE_COMMIT_AUTHOR: z.string().optional(),
  DRONE_REPO: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
