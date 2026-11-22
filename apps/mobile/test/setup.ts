/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// The keyboard follower's native side doesn't exist under Jest; the library ships its own stand-in.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
