import BsDiffPatch from './NativeBsDiffPatch';

/**
 * generate new file from old file and patch file
 * @param oldFile orignal file path
 * @param newFile new file path
 * @param patchFile patch file path
 **/
export function patch(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number> {
  return BsDiffPatch.patch(oldFile, newFile, patchFile);
}

/**
 * generate patch file from old file and new file
 * @param oldFile orignal file path
 * @param newFile new file path
 * @param patchFile patch file path
 * @returns
 */
export function diff(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number> {
  return BsDiffPatch.diff(oldFile, newFile, patchFile);
}
