/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/app/graphview/__tests__'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json']
};


