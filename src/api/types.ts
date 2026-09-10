/** Shared shapes returned by every controller call. */

/** A typed, already-parsed API response. Tests assert on this instead of a raw APIResponse. */
export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T;
  /** Raw response headers, lowercased keys — occasionally useful (e.g. pagination, rate limits). */
  headers: Record<string, string>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  /** Seconds until the access token expires, as reported by Keycloak. */
  expiresIn: number;
  tokenType: string;
}
