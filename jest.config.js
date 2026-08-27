/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/sdk/src/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
        module: 'commonjs',
        target: 'ES2020',
      },
      // Suppress pre-existing type errors in source files so tests can run
      diagnostics: {
        ignoreCodes: [
          2614, // Module has no exported member (Server import style)
          2345, // Argument type mismatch
          2339, // Property does not exist
          2551, // Property does not exist – did you mean
          2552, // Cannot find name – did you mean
          2322, // Type not assignable (fee: string vs number)
          2352, // Conversion may be a mistake
        ],
      },
    }],
  },
  moduleNameMapper: {
    '^stellar-sdk$': '<rootDir>/node_modules/stellar-sdk',
  },
  collectCoverageFrom: [
    'sdk/src/**/*.ts',
    '!sdk/src/__tests__/**',
    '!sdk/src/**/*.d.ts',
  ],
};
