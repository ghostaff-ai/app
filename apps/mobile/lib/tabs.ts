import { Platform } from 'react-native';

// On the phone the tab bar is the system's, at the bottom, and it moves scroll
// views clear of itself. On the web it floats over the top of the page, so the
// tab screens leave it room.
export const TAB_SCREEN_TOP = Platform.OS === 'web' ? 72 : 0;
