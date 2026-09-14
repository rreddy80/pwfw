import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { AuthController } from '../api/auth.controller.js';
import { HttpClient } from '../api/http-client.js';
import { logger } from '../helpers/logger.js';
import type { ApiResult, AuthTokens } from '../api/types.js';

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
 * class orchestrates the same OAuth Authorization Code + PKCE flow a real browser would on
 * the *Keycloak* side only, composed from `AuthController`'s primitives:
 *
 *   1. `AuthController.authorize` — same request the SPA's redirect would make.
 *   2. If a login form came back: `AuthController.submitLoginForm` with the credentials. If
 *      no form came back, Keycloak already recognized an existing SSO session for this
 *      request context — skip straight to its redirect.
 *   3. Follow whatever redirect chain results (sometimes straight to
 *      `redirect_uri?...code=...`, sometimes through one or more intermediate hops first
 *      depending on Keycloak version/flow config — see `followRedirectsToAuthorizationCode`),
 *      setting Keycloak's SSO session cookie along the way.
 *   4. `AuthController.authorizationCodeGrant` — exchange the code for tokens directly
 *      (useful if the test also wants a bearer token for API calls in the same run).
 *
 * The resulting `storageState` carries that SSO cookie. Load it into a fresh browser
 * context and any navigation that redirects to Keycloak for auth will silently re-use the
 * existing session and bounce straight back to the app — same trip a real browser takes
 * after a real login, minus the actual typing.
 *
 * See `docs/AUTH.md` for the full write-up and when to reach for this vs. `AuthController.passwordGrant`.
 */
export class KeycloakAuth {
  private readonly authController: AuthController;

  constructor(private readonly request: APIRequestContext) {
    this.authController = new AuthController(new HttpClient(request));
  }

  async loginForBrowserSession(
    username: string,
    password: string,
    redirectUri: string,
    options: {
      /**
       * Actually `GET` the final `redirect_uri?...code=...` (and follow any further redirect
       * chain from there) instead of just parsing `code` out of it, and let whatever's set
       * up to run there (a BFF/gateway callback that performs its own code exchange and
       * issues its own session cookies) actually run. Off by default — visiting it is a real
       * HTTP call to your app/gateway, so turning this on means that target must be
       * reachable wherever this login runs (CI included). Turn it on if cookies you expect
       * after API-mode login (or `apiHttpClient` calls) aren't showing up — see docs/AUTH.md.
       */
      visitRedirectUri?: boolean;
    } = {},
  ): Promise<BrowserSessionResult> {
    const pkce = generatePkcePair();
    const state = randomBytes(16).toString('base64url');
    // Not required by the OIDC spec for the authorization-code flow (only for
    // implicit/hybrid, where the id_token comes back through the browser URL rather than a
    // server-to-server token exchange) — Keycloak accepts this request without one. Sent
    // anyway to mirror what keycloak-js actually sends and in case a stricter client policy
    // ever requires it; we don't validate it back since there's no attacker to defend
    // against in a request we made ourselves.
    const nonce = randomBytes(16).toString('base64url');

    const authorizeResult = await this.authController.authorize({
      redirectUri,
      state,
      nonce,
      codeChallenge: pkce.codeChallenge,
    });

    const formAction = this.authController.extractLoginFormAction(authorizeResult.body);

    let redirectResponse: ApiResult<unknown>;

    if (formAction) {
      redirectResponse = await this.authController.submitLoginForm(formAction, username, password);
      if (redirectResponse.status !== 302) {
        throw new Error(
          `Keycloak login did not redirect as expected (status ${redirectResponse.status}). ` +
            'Most likely bad credentials — check TEST_USERNAME/TEST_PASSWORD.',
        );
      }
    } else {
      // No <form> in the response — Keycloak already recognized an existing SSO session for
      // this request context (e.g. this identity already logged in earlier in the same run,
      // via a fresh, uncached `APIRequestContext` that happens to carry the same cookies) and
      // skipped straight to a redirect instead of rendering the login form.
      if (authorizeResult.status !== 302) {
        throw new Error(
          `Expected either a login form or a redirect from the authorize endpoint, got ` +
            `status ${authorizeResult.status} with no form present.\n` +
            'Check KEYCLOAK_BASE_URL/KEYCLOAK_REALM/KEYCLOAK_CLIENT_ID and that the client has ' +
            '"Standard flow" enabled.',
        );
      }
      redirectResponse = authorizeResult;
      logger.info(
        'Keycloak already had a valid SSO session for this identity — skipped the login form',
      );
    }

    const codeResult = await this.followRedirectsToAuthorizationCode(
      redirectResponse,
      options.visitRedirectUri ?? false,
    );
    const tokens = await this.authController.authorizationCodeGrant(
      codeResult.body,
      redirectUri,
      pkce.codeVerifier,
    );

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
   *
   * Returns the `ApiResult` of that final redirect response, with the extracted
   * authorization code in `.body` — not just a bare string — so the caller also has
   * `status`/`headers`/`ok` for that hop if it ever needs them, instead of the code
   * needing to be re-parsed out of a header string a second time at the call site.
   */
  private async followRedirectsToAuthorizationCode(
    initial: ApiResult<unknown>,
    visitFinalRedirect: boolean,
  ): Promise<ApiResult<string>> {
    let current = initial;

    for (let hop = 1; hop <= MAX_REDIRECT_HOPS; hop++) {
      const location = current.headers['location'];
      if (!location) {
        throw new Error(
          `Keycloak returned a ${current.status} with no Location header while completing ` +
            `login (hop ${hop}).`,
        );
      }

      const code = new URL(location).searchParams.get('code');
      if (code) {
        if (visitFinalRedirect) {
          await this.visitRedirectChainForSideEffects(location);
        }
        return { ...current, body: code };
      }

      // Not the final hop yet — follow it exactly like a browser would (redirects are
      // followed via GET regardless of the method that produced them). This goes straight to
      // the request context rather than through a named AuthController endpoint since it's
      // "whatever URL Keycloak hands back next", not a fixed, nameable one.
      const response = await this.request.get(location, { maxRedirects: 0 });
      current = {
        status: response.status(),
        ok: response.ok(),
        body: undefined,
        headers: response.headers(),
      };

      if (current.status !== 302) {
        throw new Error(
          `Expected another redirect while completing Keycloak login, got status ` +
            `${current.status} instead (hop ${hop + 1}). This usually means a required ` +
            'action (update password, verify email, configure OTP, terms of service, ...) is ' +
            'blocking automated login for this user — check the account in Keycloak.',
        );
      }
    }

    throw new Error(
      `Keycloak login didn't reach an authorization code after ${MAX_REDIRECT_HOPS} redirects.`,
    );
  }

  /**
   * `visitRedirectUri: true`'s actual work: GET the real `redirect_uri?...code=...` (which
   * `followRedirectsToAuthorizationCode` deliberately never fetches otherwise) and keep
   * following as long as it keeps redirecting, so a gateway/BFF callback chain that does its
   * own code exchange and issues its own session cookies across multiple hops gets fully
   * exercised. Nothing in the response is read — the only reason this exists is the
   * `Set-Cookie` side effects it lands in `this.request`'s cookie jar automatically.
   */
  private async visitRedirectChainForSideEffects(startLocation: string): Promise<void> {
    let next: string | undefined = startLocation;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      if (!next) break;
      const url: string = next;
      const response = await this.request.get(url, { maxRedirects: 0 });

      // `.headers()` collapses multiple same-named headers into one — Set-Cookie is exactly
      // the header that commonly repeats, so it alone can silently show only one of several
      // cookies actually present. `.headersArray()` keeps every occurrence separate; run
      // with DEBUG=pw:* to see exactly what Set-Cookie(s) came back at each hop, and check
      // each one's Domain/Path/Secure/SameSite against where your later requests actually go
      // — a mismatch there (not a fetch/parsing bug) is the usual reason a cookie that *was*
      // set doesn't show up on a subsequent request.
      const setCookies = response
        .headersArray()
        .filter((h) => h.name.toLowerCase() === 'set-cookie')
        .map((h) => h.value);
      logger.debug(`visitRedirectChainForSideEffects: GET ${url} -> ${response.status()}`, {
        setCookies,
      });

      next = response.status() === 302 ? response.headers()['location'] : undefined;
    }
  }
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}
