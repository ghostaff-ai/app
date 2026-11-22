module.exports = {
  preset: 'jest-expo',
  // Off for pr:land's integration check (scripts/land-integration-check.sh): it runs
  // in a brand-new directory, which watchman can answer with an empty crawl.
  watchman: process.env.JEST_WATCHMAN !== 'false',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|@ghostaff|@supabase|phosphor-react-native))',
  ],
  moduleNameMapper: {
    '\\.glb$': '<rootDir>/test/glbStub.js',
    '^@/(.*)$': '<rootDir>/$1',
  },
};
