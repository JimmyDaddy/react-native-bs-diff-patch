import BsDiffPatch from './NativeBsDiffPatch';

export type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

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

function rejectWebOnlyApi(methodName: string): Promise<never> {
  const error = new Error(
    `${methodName} is only available on Web; use diff/patch with file paths on native platforms`
  ) as Error & { code: string };
  error.code = 'EUNSUPPORTED';
  return Promise.reject(error);
}

/**
 * Generate a binary patch in a browser Web Worker.
 */
export function diffBytes(
  _oldData: BinaryInput,
  _newData: BinaryInput
): Promise<Uint8Array> {
  return rejectWebOnlyApi('diffBytes');
}

/**
 * Apply a binary patch in a browser Web Worker.
 */
export function patchBytes(
  _oldData: BinaryInput,
  _patchData: BinaryInput
): Promise<Uint8Array> {
  return rejectWebOnlyApi('patchBytes');
}
