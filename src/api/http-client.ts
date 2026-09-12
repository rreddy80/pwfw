import type { APIRequestContext } from '@playwright/test';
import { logger } from '../helpers/logger.js';
import type { ApiResult } from './types.js';

export interface HttpClientOptions {
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
 * Deliberately does NOT resolve base URLs or serialize query params itself — `request.fetch()`
 * already does both natively (relative `path` merges against whatever `baseURL` the
 * `APIRequestContext` was created with, exactly like `page.goto()` does; `params` is a
 * first-class option). Reimplementing either here would just be a worse copy of what
 * Playwright already does — see the fixtures in `src/fixtures/api.fixtures.ts` for how each
 * controller's `HttpClient` gets a context bound to the right `baseURL`.
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

    logger.debug(
      `--> ${method} ${path}`,
      (opts.data ?? opts.form) ? { body: opts.data ?? opts.form } : undefined,
    );

    const response = await this.request.fetch(path, {
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

    logger.debug(`<-- ${status} ${method} ${path}`);

    return {
      status,
      ok: response.ok(),
      body,
      headers: responseHeaders,
    };
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
