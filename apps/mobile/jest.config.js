module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|nativewind|react-native-css-interop|@ghostaff|@supabase))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
