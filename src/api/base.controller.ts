import type { z } from 'zod';
import type { HttpClient, HttpMethod, RequestOptions } from './http-client.js';
import type { ApiResult } from './types.js';

/**
 * Base class for every API "controller" — the framework's abstraction for talking to one
 * REST resource/domain of the system under test.
 *
 * Why controllers instead of calling `request.get(...)` straight from a spec:
 *  - one place to keep the resource's base path, auth, and response typing
 *  - `validate()` gives every call an optional runtime contract check, so a backend
 *    response-shape regression fails with a precise message at the call site instead of a
 *    confusing downstream assertion failure
 *  - specs read as business actions (`usersController.createUser(...)`) instead of HTTP calls,
 *    so they stay readable when endpoints or payloads change shape
 *
 * Extend this per resource (see `UsersController`, `PostsController`) rather than adding
 * one-off methods to `HttpClient` itself.
 */
export abstract class BaseController {
  protected constructor(protected readonly http: HttpClient) {}

  /** Attach a bearer token to every subsequent call this controller makes. */
  setAuthToken(token: string | undefined): void {
    this.http.setAuthToken(token);
  }

  /**
   * Make a request (any HTTP method — the name mirrors axios's method-agnostic `request()`,
   * deliberately not `fetch`/`get`) and validate the response body against a zod schema in
   * one step. `result.body` starts out `unknown` (the response hasn't been checked yet) and
   * only becomes `T` once `schema.safeParse` actually confirms it; there's no path here that
   * hands back typed data without checking it first.
   */
  protected async request<T>(
    method: HttpMethod,
    path: string,
    schema: z.ZodType<T>,
    opts: RequestOptions = {},
  ): Promise<T> {
    const result = await this.http.send<unknown>(method, path, opts);
    return this.validate(result, schema, `${method} ${path}`);
  }

  /**
   * Parse `result.body` against a zod schema, throwing a descriptive error on mismatch.
   * `request()` above covers the common case; reach for this directly only when you need the
   * status code or headers from `result` as well as the validated body (see `AuthController`).
   */
  protected validate<T>(result: ApiResult<unknown>, schema: z.ZodType<T>, context: string): T {
    const parsed = schema.safeParse(result.body);
    if (!parsed.success) {
      throw new Error(
        `${context}: response did not match expected schema (status ${result.status}).\n` +
          `${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}\n` +
          `Body received: ${JSON.stringify(result.body)}`,
      );
    }
    return parsed.data;
  }
}
