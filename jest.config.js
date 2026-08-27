/**
 * Jest configuration for the SDK's TypeScript unit tests.
 *
 * The SDK test suite is written in TypeScript and relies on `ts-jest`; this
 * config keeps the transform consistent across all SDK test files under
 * `sdk/src/__tests__`.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/sdk/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  transformIgnorePatterns: ['node_modules/(?!(stellar-sdk|@stellar)/)'],
  testPathIgnorePatterns: ['/node_modules/'],
};