import { test, expect } from '../../src/fixtures/index.js';
import { dataFactory } from '../../src/helpers/data-factory.js';

test.describe('Posts API — data seeding pattern', () => {
  test('seeds a post via the API then reads it back', async ({ postsController }) => {
    const payload = dataFactory.post({ userId: 3 });

    const created = await postsController.createPost(payload);

    expect(created.title).toBe(payload.title);
    expect(created.userId).toBe(3);
  });

  test('lists all posts', async ({ postsController }) => {
    // No login code anywhere in this test. `postsController` is built on `apiHttpClient`
    // (see api.fixtures.ts), which is authenticated by default via the same Keycloak
    // session cookies `authenticatedPage` uses — those cookies go out on this call exactly
    // the same way they would if `postsController` sat behind a real gateway that required
    // them. Proven for real in tests/api/keycloak-cookie-session.api.spec.ts.
    const posts = await postsController.listPosts();

    expect(posts.length).toBeGreaterThan(0);
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
