import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
