export const PATCH_FORMAT: 'ENDSLEY/BSDIFF43';
export const PATCH_MANIFEST_VERSION: 1;
export const PATCH_BUNDLE_FORMAT: string;

export interface PatchArtifact {
  bytes: number;
  sha256: string;
  name?: string;
  url?: string;
}

export interface DetachedSignatureMetadata {
  algorithm: string;
  detached: true;
  keyId: string;
}

export interface PatchManifest {
  version: 1;
  format: 'ENDSLEY/BSDIFF43';
  baseline: PatchArtifact;
  patch: PatchArtifact;
  target: PatchArtifact;
  releaseId?: string;
  signature?: DetachedSignatureMetadata;
}

export interface PatchCandidate {
  format: 'ENDSLEY/BSDIFF43';
  baseline: PatchArtifact;
  patch: PatchArtifact;
  declaredTargetBytes: string;
}

export interface PatchBundle {
  version: 1;
  format: string;
  target: PatchArtifact;
  full: PatchArtifact;
  patches: PatchCandidate[];
  releaseId?: string;
  signature?: DetachedSignatureMetadata;
}

export interface PatchMetadata {
  declaredTargetBytes: string | null;
  format: 'ENDSLEY/BSDIFF43' | 'BSDIFF40' | 'UNKNOWN';
  headerBytes: number;
  issue?:
    | 'INVALID_MAGIC'
    | 'INVALID_TARGET_SIZE'
    | 'LEGACY_FORMAT'
    | 'TRUNCATED_HEADER';
  patchBytes: number;
  payloadBytes: number;
  valid: boolean;
}

export class PatchToolkitError extends Error {
  constructor(code: string, message: string);
  code: string;
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

export function canonicalJson(value: unknown): string;
export function createPatchManifest(input: {
  baseline: PatchArtifact;
  patch: PatchArtifact;
  target: PatchArtifact;
  releaseId?: string;
  signature?: DetachedSignatureMetadata;
}): PatchManifest;
export function validatePatchManifest(value: unknown): PatchManifest;
export function signingPayload(manifest: PatchManifest): string;
export function createPatchBundle(input: {
  target: PatchArtifact;
  full?: PatchArtifact;
  patches?: PatchCandidate[];
  releaseId?: string;
  signature?: DetachedSignatureMetadata;
}): PatchBundle;
export function validatePatchBundle(value: unknown): PatchBundle;
export function selectPatch(
  bundle: PatchBundle,
  options: {
    baselineSha256: string;
    maxPatchBytes?: number;
    maxPatchRatio?: number;
  }
):
  | {
      artifact: PatchArtifact;
      candidate: PatchCandidate;
      reason: 'BASELINE_MATCH';
      strategy: 'patch';
    }
  | {
      artifact: PatchArtifact;
      candidate?: PatchCandidate;
      reason:
        | 'BASELINE_NOT_FOUND'
        | 'PATCH_BYTES_EXCEEDED'
        | 'PATCH_RATIO_EXCEEDED';
      strategy: 'full';
    };
export function inspectPatchHeader(
  headerData: Uint8Array,
  patchBytes?: number
): PatchMetadata;
