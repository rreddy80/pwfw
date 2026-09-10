import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { keycloakConfig } from '../config/keycloak.config.js';
import { logger } from '../helpers/logger.js';
import type { AuthTokens } from '../api/types.js';

/** Bound on redirect hops after the credentials POST — real chains are 1-3; this just stops a genuine loop from hanging forever. */
const MAX_REDIRECT_HOPS = 8;

export interface BrowserSessionResult {
  tokens: AuthTokens;
  /** Feed straight into `browser.newContext({ storageState })` — carries the Keycloak SSO cookie. */
  storageState: Awaited<ReturnType<APIRequestContext['storageState']>>;
}

/**
 * Establishes a real Keycloak session over plain HTTP — no browser page involved — so a
 * test can land on an authenticated app screen without ever driving the login form.
 *
 * Why this exists instead of just injecting an access token into `localStorage`: most
 * keycloak-js SPA setups keep tokens in memory and re-derive auth state from Keycloak's own
 * SSO session cookie on load (silent-check-sso), not from anything the app itself persists.
 * Writing a token into storage that the app never reads accomplishes nothing. Instead, this
 * class plays the same OAuth Authorization Code + PKCE flow a real browser would on the
 * *Keycloak* side only:
 *
 *   1. GET the authorize endpoint (same request the SPA's redirect would make) — this is
 *      Keycloak rendering its login form.
 *   2. POST credentials to that form's own action URL. Keycloak responds with a redirect —
 *      sometimes straight to `redirect_uri?...code=...`, sometimes through one or more
 *      intermediate hops first depending on Keycloak version/flow config (see
 *      `followRedirectsToAuthorizationCode`) — setting its SSO session cookie along the way.
 *   3. Exchange the returned authorization code for tokens directly (useful if the test
 *      also wants a bearer token for API calls in the same run).
 *
 * The resulting `storageState` carries that SSO cookie. Load it into a fresh browser
 * context and any navigation that redirects to Keycloak for auth will silently re-use the
 * existing session and bounce straight back to the app — same trip a real browser takes
 * after a real login, minus the actual typing.
 *
 * See `docs/AUTH.md` for the full write-up and when to reach for this vs. `AuthController.passwordGrant`.
 */
export class KeycloakAuth {
  constructor(private readonly request: APIRequestContext) {}

  async loginForBrowserSession(
    username: string,
    password: string,
    redirectUri: string,
  ): Promise<BrowserSessionResult> {
    const pkce = generatePkcePair();

    const authorizeUrl = new URL(keycloakConfig.authorizeUrl);
    authorizeUrl.searchParams.set('client_id', keycloakConfig.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'openid');
    authorizeUrl.searchParams.set('code_challenge', pkce.codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    // Not required by the OIDC spec for the authorization-code flow (only for
    // implicit/hybrid, where the id_token comes back through the browser URL rather than a
    // server-to-server token exchange) — Keycloak accepts this request without one. Sent
    // anyway to mirror what keycloak-js actually sends and in case a stricter client policy
    // ever requires it; we don't validate it back since there's no attacker to defend
    // against in a request we made ourselves.
    authorizeUrl.searchParams.set('nonce', randomBytes(16).toString('base64url'));

    const authorizePage = await this.request.get(authorizeUrl.toString());
    const html = await authorizePage.text();

    const formAction = extractLoginFormAction(html);
    if (!formAction) {
      throw new Error(
        `Could not find the Keycloak login form on ${authorizeUrl.toString()}.\n` +
          'Check KEYCLOAK_BASE_URL/KEYCLOAK_REALM/KEYCLOAK_CLIENT_ID and that the client has ' +
          '"Standard flow" enabled — or the user may already have an SSO session, in which case ' +
          'Keycloak skipped the form entirely (this method assumes a clean session).',
      );
    }

    // maxRedirects: 0 — we need the raw 302s to read the auth code out of `Location`
    // ourselves, not have Playwright silently follow them.
    const loginResponse = await this.request.post(formAction, {
      form: { username, password, credentialId: '' },
      maxRedirects: 0,
    });

    if (loginResponse.status() !== 302) {
      throw new Error(
        `Keycloak login did not redirect as expected (status ${loginResponse.status()}). ` +
          'Most likely bad credentials — check TEST_USERNAME/TEST_PASSWORD.',
      );
    }

    const code = await this.followRedirectsToAuthorizationCode(loginResponse);

    const tokens = await this.exchangeCodeForTokens(code, redirectUri, pkce.codeVerifier);

    logger.info('Established Keycloak SSO session via API (no browser login form was rendered)');

    return { tokens, storageState: await this.request.storageState() };
  }

  /**
   * The credentials POST's 302 doesn't always land straight on `redirect_uri?...code=...` —
   * depending on Keycloak version/authentication-flow configuration, it can bounce through
   * one or more intermediate hops first (observed in the wild: a GET back to
   * `login-actions/authenticate`, no `session_code`/`execution` this time, carrying the
   * `AUTH_SESSION_ID`/`KC_RESTART` cookies — apparently a restart-cookie verification step
   * some flow configurations insert). A browser just follows wherever Keycloak sends it
   * next; this does the same rather than assuming a fixed hop count, and only treats a
   * non-redirect response as an actual failure.
   */
  private async followRedirectsToAuthorizationCode(initialResponse: APIResponse): Promise<string> {
    let response = initialResponse;

    for (let hop = 1; hop <= MAX_REDIRECT_HOPS; hop++) {
      const location = response.headers()['location'];
      if (!location) {
        throw new Error(
          `Keycloak returned a ${response.status()} with no Location header while completing ` +
            `login (hop ${hop}).`,
        );
      }

      const code = new URL(location).searchParams.get('code');
      if (code) return code;

      // Not the final hop yet — follow it exactly like a browser would (redirects are
      // followed via GET regardless of the method that produced them).
      response = await this.request.get(location, { maxRedirects: 0 });

      if (response.status() !== 302) {
        throw new Error(
          `Expected another redirect while completing Keycloak login, got status ` +
            `${response.status()} instead (hop ${hop + 1}). This usually means a required ` +
            'action (update password, verify email, configure OTP, terms of service, ...) is ' +
            'blocking automated login for this user — check the account in Keycloak.',
        );
      }
    }

    throw new Error(
      `Keycloak login didn't reach an authorization code after ${MAX_REDIRECT_HOPS} redirects.`,
    );
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<AuthTokens> {
    const response = await this.request.post(keycloakConfig.tokenUrl, {
      form: {
        grant_type: 'authorization_code',
        client_id: keycloakConfig.clientId,
        ...(keycloakConfig.clientSecret ? { client_secret: keycloakConfig.clientSecret } : {}),
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });

    if (!response.ok()) {
      throw new Error(
        `Token exchange failed (status ${response.status()}): ${await response.text()}`,
      );
    }

    const body = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      id_token?: string;
      expires_in: number;
      token_type: string;
    };

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      idToken: body.id_token,
      expiresIn: body.expires_in,
      tokenType: body.token_type,
    };
  }
}

function extractLoginFormAction(html: string): string | null {
  // Keycloak's default (and most custom) login themes render:
  //   <form id="kc-form-login" ... action="https://.../login-actions/authenticate?...">
  const match = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/);
  if (!match || !match[1]) return null;
  return match[1].replace(/&amp;/g, '&');
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}
