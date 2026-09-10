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

/**
 * Talks to Keycloak's OpenID Connect token endpoint directly (no browser involved).
 *
 * Use `passwordGrant` for pure API-testing scenarios where a test just needs a bearer
 * token to call the backend. For scenarios that need to land in the *browser* already
 * authenticated (skip typing credentials into the Keycloak UI but still load the real app),
 * use `KeycloakAuth.loginForBrowserSession` in `src/auth/keycloak-auth.ts` instead — see
 * `docs/AUTH.md` for why these are different problems with different solutions.
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
