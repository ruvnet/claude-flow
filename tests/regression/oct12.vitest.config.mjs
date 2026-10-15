// Isolated validation: no optional native engines, model downloads or CLI services.
export default {
  test: {
    include: [
      'v3/@claude-flow/cli/__tests__/hooks-coverage-disk.test.ts',
      'v3/@claude-flow/cli/__tests__/ruvector/coverage-router.test.ts',
    ],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
  },
};
