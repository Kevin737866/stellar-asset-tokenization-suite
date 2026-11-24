/**
 * Jest configuration for the UI package.
 *
 * Tests that only exercise pure TypeScript logic (helpers, utilities) run in
 * the Node environment and are transformed by ts-jest using the UI tsconfig.
 *
 * Run from the workspace root with:
 *   npx jest --config ui/jest.config.js
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        diagnostics: { ignoreCodes: ['TS151001'] },
      },
    ],
  },
  moduleNameMapper: {
    // Mock Next.js / shadcn UI imports that are not relevant to unit logic
    '^@/components/ui/(.*)$': '<rootDir>/src/__mocks__/ui.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Stub React and lucide-react so pure-TS helper tests run without jsdom
    '^react$': '<rootDir>/src/__mocks__/react.ts',
    '^lucide-react$': '<rootDir>/src/__mocks__/lucide-react.ts',
    // Suppress CSS module imports
    '\\.css$': '<rootDir>/src/__mocks__/fileMock.ts',
  },
  testPathIgnorePatterns: ['/node_modules/'],
};
