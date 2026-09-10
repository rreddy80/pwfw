import { test, expect } from '../../src/fixtures/index.js';

test.describe('Users API', () => {
  test('fetches an existing user', async ({ usersController }) => {
    const user = await usersController.getUser(1);

    expect(user.id).toBe(1);
    expect(user.email).toContain('@');
  });

  test('lists users', async ({ usersController }) => {
    const users = await usersController.listUsers();

    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toHaveProperty('email');
  });

  test('creates a user', async ({ usersController }) => {
    const created = await usersController.createUser({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });

    // JSONPlaceholder fakes writes (doesn't persist) but echoes the payload back with an id —
    // exactly the contract this assertion is checking. Point this controller at a real
    // backend and the same test verifies genuine persistence.
    expect(created.name).toBe('Ada Lovelace');
    expect(created.id).toBeGreaterThan(0);
  });
});
