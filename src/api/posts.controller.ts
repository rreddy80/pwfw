import { z } from 'zod';
import { BaseController } from './base.controller.js';
import type { HttpClient } from './http-client.js';

const postSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  userId: z.number(),
});

export type PostDto = z.infer<typeof postSchema>;

export interface CreatePostPayload {
  title: string;
  body: string;
  userId: number;
}

/**
 * Second example controller — used in `tests/api/posts.api.spec.ts` to demonstrate the
 * "seed via API, then assert" pattern that UI E2E specs can reuse to set up state without
 * driving the browser through every step of data creation.
 */
export class PostsController extends BaseController {
  constructor(http: HttpClient) {
    super(http);
  }

  async getPost(id: number): Promise<PostDto> {
    return this.request('GET', `/posts/${id}`, postSchema);
  }

  async listPosts(): Promise<PostDto[]> {
    return this.request('GET', '/posts', z.array(postSchema));
  }

  async listPostsByUser(userId: number): Promise<PostDto[]> {
    return this.request('GET', '/posts', z.array(postSchema), { params: { userId } });
  }

  async createPost(payload: CreatePostPayload): Promise<PostDto> {
    return this.request('POST', '/posts', postSchema, { data: payload });
  }

  async deletePost(id: number): Promise<void> {
    await this.http.delete(`/posts/${id}`);
  }
}
