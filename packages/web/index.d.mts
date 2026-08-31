export {
  classifyPatchError,
  diffBytes,
  inspectPatch,
  patchBytes,
  startDiff,
  startDiffBytes,
  startPatch,
  startPatchBytes,
  verifyPatch,
} from './web/index.mjs';

export type {
  BinaryInput,
  BinaryOperationJob,
  BinaryOperationOptions,
  BinaryOperationProgress,
  ClassifiedPatchError,
  PatchErrorCategory,
  PatchFormat,
  PatchInspectionOptions,
  PatchMetadata,
  PatchStructuralIssue,
  PatchVerificationResult,
} from './web/index.mjs';
