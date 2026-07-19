import { NativeEventEmitter } from 'react-native';

import BsDiffPatch from './NativeBsDiffPatch';

export type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

export interface BinaryOperationOptions {
  /** Cancel the Web Worker operation. */
  signal?: AbortSignal;
  /** Reject when either input exceeds this number of bytes. */
  maxInputBytes?: number;
  /** Reject when the generated or restored output exceeds this number of bytes. */
  maxOutputBytes?: number;
}

export interface NativeOperationOptions {
  /** Reject when either native input file exceeds this number of bytes. */
  maxInputBytes?: number;
  /** Reject when the generated or restored file exceeds this number of bytes. */
  maxOutputBytes?: number;
}

export interface NativeOperationProgress {
  id: string;
  operation: 'diff' | 'patch';
  phase: 'reading' | 'processing' | 'writing';
  progress: number;
}

export interface NativeOperationJob {
  id: string;
  result: Promise<number>;
  cancel(): Promise<void>;
  onProgress(listener: (event: NativeOperationProgress) => void): () => void;
}

type NativeProgressEvent = Omit<NativeOperationProgress, 'operation'>;

const NATIVE_PROGRESS_EVENT = 'BsDiffPatchProgress';
let nativeJobSequence = 0;
let nativeProgressEmitter: NativeEventEmitter | undefined;

function getNativeProgressEmitter(): NativeEventEmitter {
  if (!nativeProgressEmitter) {
    nativeProgressEmitter = new NativeEventEmitter(BsDiffPatch);
  }
  return nativeProgressEmitter;
}

function validateNativeLimit(
  value: number | undefined,
  fieldName: string
): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value <= 0) {
    const error = new Error(
      `${fieldName} must be a positive safe integer`
    ) as Error & { code: string };
    error.code = 'EINVAL';
    throw error;
  }
  return value;
}

function createNativeJob(
  operation: 'diff' | 'patch',
  oldFile: string,
  newFile: string,
  patchFile: string,
  options: NativeOperationOptions = {}
): NativeOperationJob {
  const id = `bsdiffpatch-${Date.now().toString(36)}-${++nativeJobSequence}`;
  const maxInputBytes = validateNativeLimit(
    options.maxInputBytes,
    'maxInputBytes'
  );
  const maxOutputBytes = validateNativeLimit(
    options.maxOutputBytes,
    'maxOutputBytes'
  );
  const result = BsDiffPatch[operation === 'diff' ? 'startDiff' : 'startPatch'](
    id,
    oldFile,
    newFile,
    patchFile,
    maxInputBytes,
    maxOutputBytes
  );

  return {
    id,
    result,
    async cancel() {
      await BsDiffPatch.cancel(id);
    },
    onProgress(listener) {
      const subscription = getNativeProgressEmitter().addListener(
        NATIVE_PROGRESS_EVENT,
        (event: NativeProgressEvent) => {
          if (event.id === id) {
            listener({ ...event, operation });
          }
        }
      );
      return () => subscription.remove();
    },
  };
}

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

/** Start a controllable native patch operation. */
export function startPatch(
  oldFile: string,
  newFile: string,
  patchFile: string,
  options?: NativeOperationOptions
): NativeOperationJob {
  return createNativeJob('patch', oldFile, newFile, patchFile, options);
}

/** Start a controllable native diff operation. */
export function startDiff(
  oldFile: string,
  newFile: string,
  patchFile: string,
  options?: NativeOperationOptions
): NativeOperationJob {
  return createNativeJob('diff', oldFile, newFile, patchFile, options);
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
  _newData: BinaryInput,
  _options?: BinaryOperationOptions
): Promise<Uint8Array> {
  return rejectWebOnlyApi('diffBytes');
}

/**
 * Apply a binary patch in a browser Web Worker.
 */
export function patchBytes(
  _oldData: BinaryInput,
  _patchData: BinaryInput,
  _options?: BinaryOperationOptions
): Promise<Uint8Array> {
  return rejectWebOnlyApi('patchBytes');
}
