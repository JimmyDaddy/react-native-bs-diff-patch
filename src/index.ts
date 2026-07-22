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

export type PatchFormat = 'ENDSLEY/BSDIFF43' | 'BSDIFF40' | 'UNKNOWN';

export type PatchStructuralIssue =
  | 'TRUNCATED_HEADER'
  | 'LEGACY_FORMAT'
  | 'INVALID_MAGIC'
  | 'INVALID_TARGET_SIZE';

export interface PatchInspectionOptions {
  /** Reject when the patch input exceeds this number of bytes. */
  maxInputBytes?: number;
}

export interface PatchMetadata {
  format: PatchFormat;
  patchBytes: number;
  headerBytes: number;
  payloadBytes: number;
  /** Decimal string so target sizes above Number.MAX_SAFE_INTEGER stay exact. */
  declaredTargetBytes: string | null;
  valid: boolean;
  issue?: PatchStructuralIssue;
}

export interface PatchVerificationResult {
  verified: boolean;
  restoredBytes: number;
  expectedBytes: number;
  patch: PatchMetadata;
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

function parseNativeJsonResult<T>(methodName: string, value: string): T {
  try {
    const parsed = JSON.parse(value) as T;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('result is not an object');
    }
    return parsed;
  } catch (cause) {
    const error = new Error(
      `${methodName} returned invalid native metadata`
    ) as Error & { code: string; cause?: unknown };
    error.code = 'EUNSPECIFIED';
    error.cause = cause;
    throw error;
  }
}

function rethrowPortablePatchError(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'EINPUT_TOO_LARGE' || error.code === 'EOUTPUT_TOO_LARGE')
  ) {
    (error as { code: string }).code = 'ERESOURCE';
  }
  throw error;
}

/**
 * Inspect an ENDSLEY/BSDIFF43 patch without applying it.
 * Native platforms accept a file path; Web accepts BinaryInput.
 */
export async function inspectPatch(
  patchInput: string | BinaryInput,
  options: PatchInspectionOptions = {}
): Promise<PatchMetadata> {
  if (typeof patchInput !== 'string') {
    return rejectNativeBinaryInput('inspectPatch');
  }
  try {
    const result = await BsDiffPatch.inspectPatch(
      patchInput,
      validateNativeLimit(options.maxInputBytes, 'maxInputBytes')
    );
    return parseNativeJsonResult<PatchMetadata>('inspectPatch', result);
  } catch (error) {
    return rethrowPortablePatchError(error);
  }
}

/**
 * Apply a patch to a temporary native file and compare it byte-for-byte with
 * the expected file. Web accepts the equivalent three BinaryInput values.
 */
export async function verifyPatch(
  oldInput: string | BinaryInput,
  patchInput: string | BinaryInput,
  expectedInput: string | BinaryInput,
  options: NativeOperationOptions | BinaryOperationOptions = {}
): Promise<PatchVerificationResult> {
  if (
    typeof oldInput !== 'string' ||
    typeof patchInput !== 'string' ||
    typeof expectedInput !== 'string'
  ) {
    return rejectNativeBinaryInput('verifyPatch');
  }
  try {
    const result = await BsDiffPatch.verifyPatch(
      oldInput,
      patchInput,
      expectedInput,
      validateNativeLimit(options.maxInputBytes, 'maxInputBytes'),
      validateNativeLimit(options.maxOutputBytes, 'maxOutputBytes')
    );
    return parseNativeJsonResult<PatchVerificationResult>(
      'verifyPatch',
      result
    );
  } catch (error) {
    return rethrowPortablePatchError(error);
  }
}

function rejectNativeBinaryInput(methodName: string): Promise<never> {
  const error = new Error(
    `${methodName} accepts file paths on native platforms; BinaryInput is only available on Web`
  ) as Error & { code: string };
  error.code = 'EUNSUPPORTED';
  return Promise.reject(error);
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
