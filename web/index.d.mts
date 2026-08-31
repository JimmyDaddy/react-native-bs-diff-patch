export type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

export interface BinaryOperationOptions {
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  onProgress?: (event: BinaryOperationProgress) => void;
}

export interface BinaryOperationProgress {
  operation: 'diff' | 'patch';
  phase: 'reading' | 'processing' | 'writing';
  progress: number;
}

export interface BinaryOperationJob {
  id: string;
  result: Promise<Uint8Array>;
  cancel(): Promise<void>;
  onProgress(
    listener: (event: BinaryOperationProgress & { id: string }) => void
  ): () => void;
}

export interface NativeOperationOptions {
  maxInputBytes?: number;
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
  maxInputBytes?: number;
}

export interface PatchMetadata {
  format: PatchFormat;
  patchBytes: number;
  headerBytes: number;
  payloadBytes: number;
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

export type PatchErrorCategory =
  | 'ABORTED'
  | 'RESOURCE'
  | 'INVALID_ARGUMENT'
  | 'INVALID_PATCH'
  | 'VERIFICATION'
  | 'DESTINATION'
  | 'UNSUPPORTED'
  | 'RUNTIME';

export interface ClassifiedPatchError {
  category: PatchErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
}

export function classifyPatchError(error: unknown): ClassifiedPatchError;

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

export function inspectPatch(
  patchData: BinaryInput,
  options?: PatchInspectionOptions
): Promise<PatchMetadata>;

export function verifyPatch(
  oldData: BinaryInput,
  patchData: BinaryInput,
  expectedData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<PatchVerificationResult>;

export function startDiff(
  oldData: BinaryInput,
  newData: BinaryInput,
  options?: BinaryOperationOptions
): BinaryOperationJob;

export function startPatch(
  oldData: BinaryInput,
  patchData: BinaryInput,
  options?: BinaryOperationOptions
): BinaryOperationJob;

export function startDiffBytes(
  oldData: BinaryInput,
  newData: BinaryInput,
  options?: BinaryOperationOptions
): BinaryOperationJob;

export function startPatchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput,
  options?: BinaryOperationOptions
): BinaryOperationJob;
