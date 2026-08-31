# API reference

The package exposes two platform-specific API families. Existing shared code
may import the root package and rely on its React Native/browser conditions;
standalone browser and desktop WebView consumers should use the explicit ESM
entry `react-native-bs-diff-patch/web`. Native runtimes use absolute paths; Web
uses in-memory binary values. The platform-neutral manifest helpers live in
the ESM entry `react-native-bs-diff-patch/toolkit`.

```ts
import {
  diff,
  patch,
  startDiff,
  startPatch,
  startDiffBytes,
  startPatchBytes,
  diffBytes,
  patchBytes,
  inspectPatch,
  verifyPatch,
  classifyPatchError,
  type BinaryInput,
  type BinaryOperationOptions,
  type PatchMetadata,
  type PatchVerificationResult,
} from 'react-native-bs-diff-patch';
```

## `diff`

```ts
function diff(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number>;
```

Creates a binary patch at `patchFile`. Available on Android and iOS.

- `oldFile`: existing baseline file path.
- `newFile`: existing target file path.
- `patchFile`: destination path that must not already exist.
- Resolves to `0` on success.
- Rejects rather than overwriting an existing `patchFile`.

## `patch`

```ts
function patch(
  oldFile: string,
  outputFile: string,
  patchFile: string
): Promise<number>;
```

Reconstructs the target file at `outputFile`. Available on Android and iOS.

- `oldFile`: existing baseline file path.
- `outputFile`: destination path that must not already exist. The runtime
  implementation names this argument `newFile`; its position and behavior are
  the public contract.
- `patchFile`: existing compatible patch path.
- Resolves to `0` on success.
- Rejects rather than overwriting an existing `outputFile`.

## Native `startDiff` and `startPatch`

```ts
interface NativeOperationOptions {
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

interface NativeOperationProgress {
  id: string;
  operation: 'diff' | 'patch';
  phase: 'reading' | 'processing' | 'writing';
  progress: number;
}

interface NativeOperationJob {
  id: string;
  result: Promise<number>;
  cancel(): Promise<void>;
  onProgress(listener: (event: NativeOperationProgress) => void): () => void;
}

function startDiff(
  oldFile: string,
  newFile: string,
  patchFile: string,
  options?: NativeOperationOptions
): NativeOperationJob;

function startPatch(
  oldFile: string,
  outputFile: string,
  patchFile: string,
  options?: NativeOperationOptions
): NativeOperationJob;
```

The job API is available on Android and iOS when progress, cancellation, or
resource bounds are required.

- `result` resolves to `0` or rejects with a classified native error.
- `cancel()` requests cooperative cancellation; a cancelled result rejects
  with `ECANCELLED`.
- `onProgress()` filters events to this job and returns an unsubscribe function.
- Native limits must be positive safe integers when supplied.
- Failed job operations remove their sibling temporary output and never
  overwrite an existing destination.

## `diffBytes`

```ts
type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

interface BinaryOperationOptions {
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  onProgress?: (event: BinaryOperationProgress) => void;
}

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
```

Creates a binary patch in a Web Worker. Available on Web.

- Accepts `ArrayBuffer`, any typed-array or `DataView`, and `Blob`.
- Zero-byte binary inputs are valid; native path APIs separately reject empty
  path strings.
- Preserves caller-owned buffers. `Blob` and `File` inputs are mounted
  read-only through WORKERFS instead of being copied in full on the main thread.
- Resolves to a new `Uint8Array` containing an `ENDSLEY/BSDIFF43` patch.
- Checks each input against `maxInputBytes` and the generated patch against
  `maxOutputBytes` when those limits are configured.

## `patchBytes`

```ts
function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
```

Applies a compatible patch in a Web Worker and resolves to the reconstructed
bytes. Available on Web.

- Validates the patch header before invoking the WebAssembly core.
- An empty baseline or target buffer is valid when the patch format permits it;
  malformed patch input is rejected.
- Preserves inputs and resolves to a new `Uint8Array`.
- Does not mutate `oldData` or `patchData`.
- Rejects before allocating the declared output when the patch header exceeds
  `maxOutputBytes`.

## `inspectPatch`

```ts
interface PatchInspectionOptions {
  maxInputBytes?: number;
}

interface PatchMetadata {
  format: 'ENDSLEY/BSDIFF43' | 'BSDIFF40' | 'UNKNOWN';
  patchBytes: number;
  headerBytes: number;
  payloadBytes: number;
  declaredTargetBytes: string | null;
  valid: boolean;
  issue?:
    | 'TRUNCATED_HEADER'
    | 'LEGACY_FORMAT'
    | 'INVALID_MAGIC'
    | 'INVALID_TARGET_SIZE';
}

function inspectPatch(
  patchInput: string | BinaryInput,
  options?: PatchInspectionOptions
): Promise<PatchMetadata>;
```

Reads the 24-byte patch header without applying the patch. Pass a native patch
path on Android/iOS or a `BinaryInput` on Web.

- `declaredTargetBytes` is a decimal string so values above
  `Number.MAX_SAFE_INTEGER` remain exact.
- `valid` only establishes structural compatibility. It does not authenticate
  the patch or prove that its compressed payload is intact.
- `BSDIFF40` is reported as `LEGACY_FORMAT`, not accepted as
  `ENDSLEY/BSDIFF43`.
- `maxInputBytes` bounds the patch file or binary input before its header is
  inspected.

## `verifyPatch`

```ts
interface PatchVerificationResult {
  verified: boolean;
  restoredBytes: number;
  expectedBytes: number;
  patch: PatchMetadata;
}

// Android / iOS paths
function verifyPatch(
  oldFile: string,
  patchFile: string,
  expectedFile: string,
  options?: NativeOperationOptions
): Promise<PatchVerificationResult>;

// Web binary values
function verifyPatch(
  oldData: BinaryInput,
  patchData: BinaryInput,
  expectedData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<PatchVerificationResult>;
```

Applies the patch and compares the restored result with the expected target
byte-for-byte.

- A valid match resolves with `verified: true`; a well-formed patch that
  restores different bytes resolves with `verified: false`.
- Malformed or incompatible structure rejects with `EPATCH`.
- Native implementations use a library-owned temporary output and remove it on
  success, mismatch, or failure. The method never replaces application data.
- Web verification uses the same Worker/Wasm path as `patchBytes` and honors
  `AbortSignal` and byte limits.
- Resource-limit failures from these portable APIs use `ERESOURCE` on every
  platform.

## Web operation options

- `signal` cancels the current Web operation. A call with a signal receives a
  dedicated Worker so aborting it cannot interrupt another request.
- `maxInputBytes` limits each supplied binary input, not their sum.
- `maxOutputBytes` limits the generated patch or restored output.
- `onProgress` receives real `reading`, `processing`, and `writing` checkpoints
  emitted by the C core.
- Limits must be non-negative safe integers. Invalid limits reject with
  `EINVAL`; exceeded limits reject with `ERESOURCE`.

The binary APIs accept the options argument on native only to keep shared
wrappers source-compatible, then reject with `EUNSUPPORTED` as usual. Native
path operations use `startDiff` or `startPatch` for equivalent controls.

## Web jobs

On Web, `startDiff()` and `startPatch()` accept binary inputs and return a job
whose result is `Promise<Uint8Array>`. `startDiffBytes()` and
`startPatchBytes()` are explicit aliases for shared cross-platform wrappers.

```ts
const job = startPatchBytes(oldFile, patchFile, {
  maxOutputBytes: 128 * 1024 * 1024,
});

const unsubscribe = job.onProgress(({ phase, progress }) => {
  renderProgress(phase, progress);
});

try {
  const restored = await job.result;
  // await job.cancel();
} finally {
  unsubscribe();
}
```

Job cancellation terminates only its dedicated Worker. `result` rejects with
`EABORTED`, while `cancel()` resolves after that result reaches a terminal
state and the Worker/listener cleanup has completed. Calling `cancel()` again
after completion is safe and does not change the settled result. Progress is
sourced from the C/WASM operation and never simulated.

## Availability behavior

All functions remain exported so shared code has one stable import shape.
Calling `diffBytes` or `patchBytes` on native rejects with `EUNSUPPORTED`.
Calling `diff` or `patch` on Web rejects with `EUNSUPPORTED`; binary
`startDiff` and `startPatch` are available. `startDiffBytes` and
`startPatchBytes` reject on native. `inspectPatch` and `verifyPatch` are
available on every platform, but require native paths on Android/iOS and binary
values on Web.

Importing the Web entry during server-side rendering does not start a Worker.
Calling a binary API without browser Worker support rejects with
`EUNSUPPORTED`.

## Error shape

Rejected operations expose a normal `Error` with a string `code` when the
platform can classify the failure.

```ts
type PatchError = Error & { code?: string };
```

| Code                | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `EINVAL`            | Native empty/duplicate paths or invalid input/options; zero-byte binary inputs are valid. |
| `ENOENT`            | A required native file does not exist.                      |
| `EEXIST`            | A native output path already exists.                        |
| `EUNSUPPORTED`      | The selected API is not available on the current platform.  |
| `EUNAVAILABLE`      | The native module worker has already shut down.             |
| `ECANCELLED`        | A native job was cooperatively cancelled.                   |
| `EINPUT_TOO_LARGE`  | A native input exceeded `maxInputBytes`.                    |
| `EOUTPUT_TOO_LARGE` | Native generated/restored output exceeded its limit.        |
| `EABORTED`          | The Web operation was cancelled through its signal.         |
| `ERESOURCE`         | A portable or Web input/output byte limit was exceeded.     |
| `EDIFF`             | The native diff core rejected or could not write the input. |
| `EPATCH`            | The native patch core rejected a malformed patch or output. |
| `EWEBASSEMBLY`      | WebAssembly loading, patch validation, or execution failed. |
| `EUNSPECIFIED`      | An unclassified native exception occurred.                  |

Treat error messages as diagnostic text rather than a stable machine-readable
contract. Branch on `code` when recovery behavior differs.

`classifyPatchError(error)` normalizes platform-specific codes into
`ABORTED`, `RESOURCE`, `INVALID_ARGUMENT`, `INVALID_PATCH`, `VERIFICATION`,
`DESTINATION`, `UNSUPPORTED`, or `RUNTIME`, while preserving the original
code and message.

Native validation stops before entering the C core. Web failures related to
Worker startup, patch validation, or WebAssembly execution use
`EWEBASSEMBLY` unless a more specific code is available.

## Concurrency and ordering

Each native platform uses a serial library-owned queue shared by promise and
job operations. Cancelling a queued job prevents it from entering the C core;
cancelling an active job is observed cooperatively. Web calls without a
signal share one module Worker, a serialized request queue, and a cached
WebAssembly module. Calls with a signal use a dedicated Worker so cancellation
is operation-local. Apply an application-level concurrency and memory budget
for large browser inputs.

## Patch format

Runtime operations read or write `ENDSLEY/BSDIFF43` patches. Other bsdiff
variants are not accepted automatically. Convert existing `BSDIFF40` files
offline with the Node CLI, then verify them before release:

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
```
