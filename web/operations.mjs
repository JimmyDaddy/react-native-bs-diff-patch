import createBsDiffPatchModule from './bsdiffpatch.mjs';
import {
  classifyRuntimeErrorCode,
  createOperationRuntime,
} from './operation-runtime.mjs';

const { convertBsdiff40, runOperation } = createOperationRuntime(
  createBsDiffPatchModule
);

export { classifyRuntimeErrorCode, convertBsdiff40, runOperation };
