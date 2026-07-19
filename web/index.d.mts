export type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

export interface BinaryOperationOptions {
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

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
  newData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;

export function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
