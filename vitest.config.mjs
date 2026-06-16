import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/test/**/*.test.mjs',
      'packages/cli/test/**/*.test.mjs',
      'packages/vitest/test/**/*.test.mjs',
    ],
  },
});
