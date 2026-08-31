import type { PatchArtifact, PatchManifest } from '../toolkit/index.js';

export interface NodeOperationOptions {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  onProgress?: (event: {
    operation: 'diff' | 'patch';
    phase: 'reading' | 'processing' | 'writing';
    progress: number;
  }) => void;
}

export interface NodeOperationResult {
  bytes: number;
  outputPath: string;
  sha256: string;
}

export function sha256Bytes(data: ArrayBufferView): string;
export function sha256File(filePath: string): Promise<string>;
export function describeFile(
  filePath: string,
  options?: { name?: string; url?: string }
): Promise<PatchArtifact>;
export function inspectPatchFile(
  patchPath: string
): Promise<import('../toolkit/index.js').PatchMetadata>;
export function diffFiles(
  oldPath: string,
  newPath: string,
  outputPath: string,
  options?: NodeOperationOptions
): Promise<NodeOperationResult>;
export function patchFiles(
  oldPath: string,
  patchPath: string,
  outputPath: string,
  options?: NodeOperationOptions
): Promise<NodeOperationResult>;
export function verifyPatchFiles(
  oldPath: string,
  patchPath: string,
  expectedPath: string
): Promise<{
  expectedBytes: number;
  expectedSha256: string;
  restoredBytes: number;
  restoredSha256: string;
  verified: boolean;
}>;
export function createFilePatchManifest(
  oldPath: string,
  patchPath: string,
  targetPath: string,
  options?: {
    baselineName?: string;
    baselineUrl?: string;
    patchName?: string;
    patchUrl?: string;
    targetName?: string;
    targetUrl?: string;
    releaseId?: string;
    signature?: PatchManifest['signature'];
  }
): Promise<PatchManifest>;
export function restoreVerified(
  oldPath: string,
  patchPath: string,
  outputPath: string,
  manifest: PatchManifest,
  options?: NodeOperationOptions
): Promise<NodeOperationResult>;
export function convertBsdiff40File(
  inputPath: string,
  outputPath: string
): Promise<NodeOperationResult>;
