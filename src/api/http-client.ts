import type { APIRequestContext } from '@playwright/test';
import { logger } from '../helpers/logger.js';
import type { ApiResult } from './types.js';

export interface HttpClientOptions {
  /**
   * Base URL to resolve relative `path` values against — joined explicitly here rather than
   * left to Playwright's own `APIRequestContext` `baseURL` option, because that one follows
   * strict URL-resolution semantics: a relative path starting with `/` is an "absolute path
   * reference", which *replaces* the base URL's own path rather than appending after it. Fine
   * for a base URL with no path component (our demo target), silently wrong the moment it
   * has one (`https://gateway.corp.com/api` + `/posts` resolves to `https://gateway.corp.com/posts`
   * via that mechanism — the `/api` prefix vanishes). Every controller in this repo writes
   * paths with a leading slash (`'/posts'`), so this joins correctly regardless rather than
   * requiring every path to avoid one.
   */
  baseUrl?: string;
  /** Headers applied to every request from this client (e.g. Content-Type). */
  defaultHeaders?: Record<string, string>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  headers?: Record<string, string>;
  data?: unknown;
  /** application/x-www-form-urlencoded body (e.g. OAuth token endpoints). Mutually exclusive with `data`. */
  form?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  /** Set to 0 to inspect a redirect response directly instead of Playwright silently following it. */
  maxRedirects?: number;
}

/**
 * Thin, logged wrapper around Playwright's `APIRequestContext`.
 *
 * This is the ONE place that knows how to turn a Playwright `APIResponse` into a typed,
 * already-`.json()`-parsed `ApiResult<T>`. Controllers build on top of this; tests should
 * never reach for `APIRequestContext` directly — see `BaseController`.
 *
 * Does NOT reimplement query-param serialization — `request.fetch()`'s `params` option
 * already does that correctly, no reason to duplicate it. Base-URL joining is the one thing
 * this *does* do itself rather than leaving to Playwright — see `HttpClientOptions.baseUrl`
 * for why letting `request.fetch()` handle it natively silently breaks the moment the base
 * URL has its own path prefix (a real gateway, not our path-less demo target).
 */
export class HttpClient {
  private bearerToken: string | undefined;

  constructor(
    private readonly request: APIRequestContext,
    private readonly options: HttpClientOptions = {},
  ) {}

  /** Attach a bearer token to every subsequent request made by this client instance. */
  setAuthToken(token: string | undefined): void {
    this.bearerToken = token;
  }

  async send<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      ...this.options.defaultHeaders,
      ...opts.headers,
    };
    // `!== undefined`, not a truthy check — setAuthToken('') is a deliberately distinct case
    // from never calling setAuthToken at all: an empty-but-present Authorization header
    // (`Bearer `) vs. no Authorization header whatsoever. A truthy check here would collapse
    // both into "no header", making it impossible to test a backend's handling of an empty
    // token as anything other than a missing one.
    if (this.bearerToken !== undefined) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }

    const url = this.resolveUrl(path);

    logger.debug(
      `--> ${method} ${url}`,
      (opts.data ?? opts.form) ? { body: opts.data ?? opts.form } : undefined,
    );

    const response = await this.request.fetch(url, {
      method,
      headers,
      data: opts.form ? undefined : opts.data,
      form: opts.form,
      params: opts.params,
      maxRedirects: opts.maxRedirects,
    });

    const status = response.status();
    const rawBody = await response.text();
    const body = parseJsonSafely<T>(rawBody);
    const responseHeaders = response.headers();

    logger.debug(`<-- ${status} ${method} ${url}`);

    return {
      status,
      ok: response.ok(),
      body,
      headers: responseHeaders,
    };
  }

  /**
   * `path` is already absolute (AuthController's calls to Keycloak's fully-qualified
   * endpoints) — use it untouched. Otherwise join it onto `options.baseUrl` by plain string
   * concatenation (normalizing away any doubled/missing slash at the join point), not via
   * `new URL(path, base)` — that constructor treats a leading `/` on `path` as "replace the
   * base's path entirely", which is exactly the bug this class exists to avoid. No
   * `options.baseUrl` at all means this client was built to always receive full URLs itself.
   */
  private resolveUrl(path: string): string {
    if (!this.options.baseUrl || /^https?:\/\//i.test(path)) return path;
    return `${this.options.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  get = <T>(path: string, opts?: RequestOptions) => this.send<T>('GET', path, opts);
  post = <T>(path: string, opts?: RequestOptions) => this.send<T>('POST', path, opts);
  put = <T>(path: string, opts?: RequestOptions) => this.send<T>('PUT', path, opts);
  patch = <T>(path: string, opts?: RequestOptions) => this.send<T>('PATCH', path, opts);
  delete = <T>(path: string, opts?: RequestOptions) => this.send<T>('DELETE', path, opts);
}

function parseJsonSafely<T>(raw: string): T {
  if (!raw) return undefined as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Non-JSON response (e.g. plain-text error page) — hand back the raw text rather than throwing,
    // so the caller's status-code assertion still gets a chance to produce the real failure message.
    return raw as unknown as T;
  }
}
