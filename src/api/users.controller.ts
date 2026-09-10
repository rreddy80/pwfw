import { z } from 'zod';
import { BaseController } from './base.controller.js';
import type { HttpClient } from './http-client.js';

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

export type UserDto = z.infer<typeof userSchema>;

export interface CreateUserPayload {
  name: string;
  email: string;
}

/**
 * Example controller against the demo REST target (JSONPlaceholder).
 * Swap `API_BASE_URL` for your real service and this class is the template for adding
 * your own resource controllers — same shape, same `request()` pattern.
 */
export class UsersController extends BaseController {
  constructor(http: HttpClient) {
    super(http);
  }

  async getUser(id: number): Promise<UserDto> {
    return this.request('GET', `/users/${id}`, userSchema);
  }

  async listUsers(): Promise<UserDto[]> {
    return this.request('GET', '/users', z.array(userSchema));
  }

  /**
   * JSONPlaceholder fakes writes (it always echoes the payload back with a new id, without
   * persisting it) — that's expected here since it's a demo target. Point this at a real
   * backend and it becomes a genuine data-seeding call.
   */
  async createUser(payload: CreateUserPayload): Promise<UserDto> {
    return this.request('POST', '/users', userSchema, { data: payload });
  }
}
