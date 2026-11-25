const path = require('path');

module.exports = {
  preset: 'jest-expo',
  // Off for pr:land's integration check (scripts/land-integration-check.sh): it runs
  // in a brand-new directory, which watchman can answer with an empty crawl.
  watchman: process.env.JEST_WATCHMAN !== 'false',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|@ghostaff|@supabase|phosphor-react-native|standard-navigation))',
  ],
  moduleNameMapper: {
    '\\.glb$': '<rootDir>/test/glbStub.js',
    // marked ships ESM only. Jest's babel would transform it, and its Node target
    // rewrites the named groups in marked's regexes into numbered ones, which breaks
    // emphasis after a code span. Metro (Hermes) leaves them alone, so jest loads the
    // package's own CommonJS build untouched.
    '^marked$': path.join(path.dirname(require.resolve('marked/package.json')), 'lib/marked.umd.js'),
    '^@/(.*)$': '<rootDir>/$1',
  },
};
