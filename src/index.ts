import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'react-native-bs-diff-patch' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const BsDiffPatch = NativeModules.BsDiffPatch
  ? NativeModules.BsDiffPatch
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export function patch(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number> {
  return BsDiffPatch.patch(oldFile, newFile, patchFile);
}

export function diff(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number> {
  return BsDiffPatch.diff(oldFile, newFile, patchFile);
}
