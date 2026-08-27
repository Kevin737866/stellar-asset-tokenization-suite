/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/sdk/src/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2020',
          lib: ['ES2020'],
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          strict: false,
          noImplicitAny: false,
          resolveJsonModule: true,
        },
        diagnostics: {
          // Only surface errors that would cause a runtime failure
          warnOnly: true,
        },
      },
    ],
  },
  // Tell Jest to also transform files under sdk/src (not just __tests__)
  transformIgnorePatterns: [
    'node_modules/(?!(@stellar|stellar-sdk)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleDirectories: ['node_modules'],
};
