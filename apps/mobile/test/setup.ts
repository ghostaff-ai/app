/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// The keyboard follower's native side doesn't exist under Jest; the library ships its own stand-in.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
// expo-audio's native side doesn't exist under Jest either: a player that plays
// nothing, for screens that draw a voice note. Tests that drive the recorder or
// the player mock it themselves.
jest.mock('expo-audio', () => {
  const player = { replace: () => {}, play: () => {}, pause: () => {}, seekTo: async () => {} };
  return {
    useAudioPlayer: () => player,
    useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false }),
    useAudioRecorder: () => ({}),
    setAudioModeAsync: async () => {},
    requestRecordingPermissionsAsync: async () => ({ granted: false }),
    IOSOutputFormat: { MPEG4AAC: 'aac ' },
    AudioQuality: { MEDIUM: 64 },
  };
});
