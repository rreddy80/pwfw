import { test, expect } from '../../src/fixtures/index.js';
import { dataFactory } from '../../src/helpers/data-factory.js';

test.describe('Posts API — data seeding pattern', () => {
  test('seeds a post via the API then reads it back', async ({ postsController }) => {
    const payload = dataFactory.post({ userId: 3 });

    const created = await postsController.createPost(payload);

    expect(created.title).toBe(payload.title);
    expect(created.userId).toBe(3);
  });

  test('lists posts for a user', async ({ postsController }) => {
    const posts = await postsController.listPostsByUser(1);

    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.userId).toBe(1);
    }
  });

  test('deletes a post', async ({ postsController }) => {
    await expect(postsController.deletePost(1)).resolves.not.toThrow();
  });
});
