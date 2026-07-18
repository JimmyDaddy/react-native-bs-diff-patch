export type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

export function diff(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number>;

export function patch(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number>;

export function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput
): Promise<Uint8Array>;

export function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput
): Promise<Uint8Array>;
