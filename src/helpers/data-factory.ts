import { faker } from '@faker-js/faker';
import type { CreatePostPayload } from '../api/posts.controller.js';
import type { CreateUserPayload } from '../api/users.controller.js';

/**
 * Builders for test data used to seed the system under test via the API layer.
 * Each builder returns sensible random defaults and accepts an `overrides` object so a
 * test can pin down only the field(s) it actually cares about — the rest stays random,
 * which keeps tests from silently depending on unstated fixture values.
 */
export const dataFactory = {
  user(overrides: Partial<CreateUserPayload> = {}): CreateUserPayload {
    return {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      ...overrides,
    };
  },

  post(overrides: Partial<CreatePostPayload> = {}): CreatePostPayload {
    return {
      title: faker.lorem.sentence(),
      body: faker.lorem.paragraph(),
      userId: faker.number.int({ min: 1, max: 10 }),
      ...overrides,
    };
  },
};
