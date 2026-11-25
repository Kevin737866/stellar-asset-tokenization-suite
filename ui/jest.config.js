/**
 * Jest configuration for UI component unit tests.
 *
 * Uses the Node test environment (not jsdom) so pure TypeScript/logic tests
 * run without a browser environment.  React component rendering tests are out
 * of scope here; this config covers the exported helper functions from
 * DashboardErrorBoundary and other components.
 *
 * Module aliases mirror next.config.js / tsconfig.json path mappings.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Relaxed options for the test environment
          jsx: 'react',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          paths: {
            '@/*': ['<rootDir>/src/*'],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    // Path alias used by components
    '^@/components/ui/(.*)$': '<rootDir>/src/__mocks__/ui.ts',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Stub heavy/visual imports that crash in a node environment
    '^react$': '<rootDir>/src/__mocks__/react.ts',
    '^lucide-react$': '<rootDir>/src/__mocks__/lucide-react.ts',
    '^recharts$': '<rootDir>/src/__mocks__/recharts.ts',
    '\\.css$': '<rootDir>/src/__mocks__/fileMock.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!(stellar-sdk|@stellar)/)'],
  testPathIgnorePatterns: ['/node_modules/'],
};
