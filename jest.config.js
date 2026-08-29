/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/sdk/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // diagnostics off + isolatedModules: each file transpiled in isolation
      // via ts.transpileModule() — no language service, no full type graph.
      // This avoids OOM on resource-constrained runners.
      // Type safety is still enforced by the separate `tsc` build.
      diagnostics: false,
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        lib: ['ES2020'],
        esModuleInterop: true,
        skipLibCheck: true,
        isolatedModules: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        resolveJsonModule: true,
        moduleResolution: 'node',
        allowSyntheticDefaultImports: true,
      },
    }],
  },
  // Redirect heavy stellar packages to lightweight mocks so ts-jest does not
  // attempt to load their type declarations (which causes OOM).
  moduleNameMapper: {
    '^stellar-sdk$': '<rootDir>/sdk/src/__mocks__/stellar-sdk.ts',
    '^@stellar/stellar-base$': '<rootDir>/sdk/src/__mocks__/@stellar/stellar-base.ts',
    '^@stellar/stellar-sdk$': '<rootDir>/sdk/src/__mocks__/@stellar/stellar-sdk.ts',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
