// Hardware-button identifiers used by the device-control footer.
// Android values match `adb shell input keyevent <numeric>` codes from
// https://developer.android.com/reference/android/view/KeyEvent.
// iOS strings are the names recognized by WDA's /wda/pressButton, mapped
// in src/device-managers/ios/WDAClient.ts.

export const ANDROID_KEYCODE = {
  HOME: 3,
  BACK: 4,
  APP_SWITCH: 187,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
} as const;

export const IOS_BUTTON = {
  HOME: 'home',
  VOLUME_UP: 'volumeup',
  VOLUME_DOWN: 'volumedown',
} as const;
