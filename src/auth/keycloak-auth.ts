import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { keycloakConfig } from '../config/keycloak.config.js';
import { logger } from '../helpers/logger.js';
import type { AuthTokens } from '../api/types.js';

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
 *   2. POST credentials to that form's own action URL. Keycloak responds with a redirect
 *      back to the app and, critically, sets its SSO session cookie in the process.
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

    // maxRedirects: 0 — we need the raw 302 to read the auth code out of `Location`
    // ourselves, not have Playwright silently follow it.
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

    const location = loginResponse.headers()['location'];
    const code = location ? new URL(location).searchParams.get('code') : null;
    if (!code) {
      throw new Error(`Keycloak redirected without an authorization code (Location: ${location}).`);
    }

    const tokens = await this.exchangeCodeForTokens(code, redirectUri, pkce.codeVerifier);

    logger.info('Established Keycloak SSO session via API (no browser login form was rendered)');

    return { tokens, storageState: await this.request.storageState() };
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
