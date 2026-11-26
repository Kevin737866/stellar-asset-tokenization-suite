module.exports = {
  rootDir: '../../..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/ui/src/components'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          jsx: 'react-jsx',
          lib: ['ES2020', 'DOM'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          moduleResolution: 'node',
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
};
