import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules'],
  },
  resolve: {
    alias: {
      obsidian: '/dev/null',
    },
  },
});
