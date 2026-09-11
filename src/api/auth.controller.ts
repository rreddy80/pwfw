import { z } from 'zod';
import { keycloakConfig } from '../config/keycloak.config.js';
import { BaseController } from './base.controller.js';
import type { HttpClient } from './http-client.js';
import type { ApiResult, AuthTokens } from './types.js';

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
  expires_in: z.number(),
  token_type: z.string(),
});

const userInfoSchema = z.object({
  sub: z.string(),
  preferred_username: z.string(),
  email: z.string().optional(),
});

export type UserInfo = z.infer<typeof userInfoSchema>;

export interface AuthorizeParams {
  redirectUri: string;
  /** Caller-supplied so it can be correlated/verified against the final redirect; Keycloak just echoes it back. */
  state: string;
  scope?: string;
  responseType?: string;
  responseMode?: string;
  nonce?: string;
  /** PKCE (RFC 7636) code challenge — required if the client enforces PKCE (our demo realm's `demo-app` client does). Omit if the target client doesn't need it. */
  codeChallenge?: string;
}

/**
 * Talks to Keycloak's OpenID Connect endpoints directly (no browser involved) — both the
 * token endpoint (`passwordGrant`, `refreshToken`, `authorizationCodeGrant`) and the raw
 * authorize/login-form endpoints (`authorize`, `submitLoginForm`) that a browser hits during
 * a real login.
 *
 * Use `passwordGrant` for pure API-testing scenarios where a test just needs a bearer
 * token to call the backend. For scenarios that need to land in the *browser* already
 * authenticated (skip typing credentials into the Keycloak UI but still load the real app),
 * `KeycloakAuth.loginForBrowserSession` (`src/auth/keycloak-auth.ts`) composes `authorize` +
 * `submitLoginForm` + `authorizationCodeGrant` from this class into that flow, adding PKCE,
 * redirect-chain handling, and SSO-cookie capture on top — see `docs/AUTH.md` for why these
 * are different problems with different solutions, and reach for the lower-level methods
 * here directly only if you need finer control than that orchestration gives you.
 */
export class AuthController extends BaseController {
  constructor(http: HttpClient) {
    super(http);
  }

  /**
   * Resource Owner Password Credentials grant ("Direct Access Grants" in Keycloak client
   * settings must be enabled). Returns tokens ready to use as a Bearer header via
   * `controller.setAuthToken(tokens.accessToken)`.
   */
  async passwordGrant(username: string, password: string): Promise<AuthTokens> {
    const result = await this.http.post<unknown>(keycloakConfig.tokenUrl, {
      form: {
        grant_type: 'password',
        client_id: keycloakConfig.clientId,
        // Without an explicit `openid` scope request, Keycloak issues a token that's valid
        // for the token endpoint itself but rejected (403 insufficient_scope) by any real
        // OIDC-protected resource, including its own /userinfo endpoint — this bit us in
        // testing, worth keeping explicit rather than relying on a default.
        scope: 'openid',
        ...(keycloakConfig.clientSecret ? { client_secret: keycloakConfig.clientSecret } : {}),
        username,
        password,
      },
    });
    return this.toAuthTokens(result, 'password grant');
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const result = await this.http.post<unknown>(keycloakConfig.tokenUrl, {
      form: {
        grant_type: 'refresh_token',
        client_id: keycloakConfig.clientId,
        ...(keycloakConfig.clientSecret ? { client_secret: keycloakConfig.clientSecret } : {}),
        refresh_token: refreshToken,
      },
    });
    return this.toAuthTokens(result, 'refresh_token grant');
  }

  /** Authorization Code grant — exchanges a code from `submitLoginForm` (or an
   * already-authenticated `authorize()` call) for tokens. `codeVerifier` is required if the
   * original `authorize()` call sent a `codeChallenge`. */
  async authorizationCodeGrant(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<AuthTokens> {
    const result = await this.http.post<unknown>(keycloakConfig.tokenUrl, {
      form: {
        grant_type: 'authorization_code',
        client_id: keycloakConfig.clientId,
        ...(keycloakConfig.clientSecret ? { client_secret: keycloakConfig.clientSecret } : {}),
        code,
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      },
    });
    return this.toAuthTokens(result, 'authorization_code grant');
  }

  /**
   * GET the authorize endpoint — step 1 of driving a Keycloak login purely over HTTP.
   * Redirects are NOT followed (`maxRedirects: 0`): the caller needs the raw response to
   * tell a fresh login apart from an already-authenticated one. Pass the response body to
   * `extractLoginFormAction` — a URL back means a login form was rendered (fresh login
   * needed, use `submitLoginForm` next); `null` means Keycloak recognized an existing SSO
   * session for this request context and skipped straight to a redirect (`result.headers.location`
   * already has what you need, nothing left to submit).
   */
  async authorize(params: AuthorizeParams): Promise<ApiResult<string>> {
    return this.http.get<string>(keycloakConfig.authorizeUrl, {
      params: {
        client_id: keycloakConfig.clientId,
        redirect_uri: params.redirectUri,
        state: params.state,
        response_type: params.responseType ?? 'code',
        response_mode: params.responseMode ?? 'query',
        scope: params.scope ?? 'openid',
        ...(params.nonce ? { nonce: params.nonce } : {}),
        ...(params.codeChallenge
          ? { code_challenge: params.codeChallenge, code_challenge_method: 'S256' }
          : {}),
      },
      maxRedirects: 0,
    });
  }

  /**
   * POST credentials to a login form's own `action` URL (from `authorize()`'s body via
   * `extractLoginFormAction`) — step 2 of the same flow. Redirects are not followed for the
   * same reason as `authorize()`: a successful login redirects (302, read the code from
   * `Location`); a failed one re-renders the same form instead (200) rather than redirecting.
   */
  async submitLoginForm(
    actionUrl: string,
    username: string,
    password: string,
  ): Promise<ApiResult<string>> {
    return this.http.post<string>(actionUrl, {
      form: { username, password, credentialId: '' },
      maxRedirects: 0,
    });
  }

  /**
   * Parses the login form's `action` URL out of an `authorize()` response body. `null` means
   * no `<form>` was present in the response — see `authorize()`'s doc comment for what that means.
   */
  extractLoginFormAction(html: string): string | null {
    // A redirect response (the "already authenticated" case) has an empty body — genuinely
    // no form, not an error, so this is a normal input here, not a bug to guard against.
    if (!html) return null;

    // Keycloak's default (and most custom) login themes render:
    //   <form id="kc-form-login" ... action="https://.../login-actions/authenticate?...">
    // Matching this specific form (not just the first "<form" on the page) matters — some
    // themes include other decorative forms (locale switcher, etc.) that a generic match
    // would grab instead.
    const match = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/);
    if (!match?.[1]) return null;
    return match[1].replace(/&amp;/g, '&');
  }

  /**
   * A genuinely Keycloak-protected endpoint (401s without a valid bearer token) — this is
   * what proves a token obtained via `passwordGrant` actually authenticates a backend call,
   * rather than just being fetched and never used. See `tests/api/keycloak-protected.api.spec.ts`.
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const result = await this.http.get<unknown>(keycloakConfig.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return this.validate(result, userInfoSchema, 'GET userinfo endpoint');
  }

  /** Unvalidated variant for asserting on the raw status — e.g. confirming a 401 without a token. */
  async getUserInfoRaw(accessToken?: string): Promise<ApiResult<unknown>> {
    return this.http.get(keycloakConfig.userInfoUrl, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  }

  private toAuthTokens(result: ApiResult<unknown>, context: string): AuthTokens {
    const parsed = this.validate(result, tokenResponseSchema, `POST token endpoint (${context})`);
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      idToken: parsed.id_token,
      expiresIn: parsed.expires_in,
      tokenType: parsed.token_type,
    };
  }
}
