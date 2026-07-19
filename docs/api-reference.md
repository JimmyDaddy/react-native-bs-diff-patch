# API reference

The package exposes two platform-specific API families from the same import
path. Native runtimes use absolute paths; Web uses in-memory binary values.

```ts
import {
  diff,
  patch,
  diffBytes,
  patchBytes,
  type BinaryInput,
  type BinaryOperationOptions,
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

## `diffBytes`

```ts
type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

interface BinaryOperationOptions {
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
```

Creates a binary patch in a Web Worker. Available on Web.

- Accepts `ArrayBuffer`, any typed-array or `DataView`, and `Blob`.
- Copies inputs, so buffers owned by the caller are not detached.
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
- Copies inputs and resolves to a new `Uint8Array`.
- Does not mutate `oldData` or `patchData`.
- Rejects before allocating the declared output when the patch header exceeds
  `maxOutputBytes`.

## Web operation options

- `signal` cancels the current Web operation. A call with a signal receives a
  dedicated Worker so aborting it cannot interrupt another request.
- `maxInputBytes` limits each supplied binary input, not their sum.
- `maxOutputBytes` limits the generated patch or restored output.
- Limits must be non-negative safe integers. Invalid limits reject with
  `EINVAL`; exceeded limits reject with `ERESOURCE`.

The binary APIs accept the options argument on native only to keep shared
wrappers source-compatible, then reject with `EUNSUPPORTED` as usual. Native
resource policy remains the application's filesystem/workflow responsibility.

## Availability behavior

All four functions remain exported so shared code has one stable import shape.
Calling `diffBytes` or `patchBytes` on native rejects with `EUNSUPPORTED`.
Calling `diff` or `patch` on Web behaves the same way.

Importing the Web entry during server-side rendering does not start a Worker.
Calling a binary API without browser Worker support rejects with
`EUNSUPPORTED`.

## Error shape

Rejected operations expose a normal `Error` with a string `code` when the
platform can classify the failure.

```ts
type PatchError = Error & { code?: string };
```

| Code           | Meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `EINVAL`       | Empty, duplicate, or invalid input.                         |
| `ENOENT`       | A required native file does not exist.                      |
| `EEXIST`       | A native output path already exists.                        |
| `EUNSUPPORTED` | The selected API is not available on the current platform.  |
| `EUNAVAILABLE` | The native module worker has already shut down.             |
| `EABORTED`     | The Web operation was cancelled through its signal.         |
| `ERESOURCE`    | A configured Web input or output byte limit was exceeded.   |
| `EDIFF`        | The native diff core rejected or could not write the input. |
| `EPATCH`       | The native patch core rejected a malformed patch or output. |
| `EWEBASSEMBLY` | WebAssembly loading, patch validation, or execution failed. |
| `EUNSPECIFIED` | An unclassified native exception occurred.                  |

Treat error messages as diagnostic text rather than a stable machine-readable
contract. Branch on `code` when recovery behavior differs.

Native validation stops before entering the C core. Web failures related to
Worker startup, patch validation, or WebAssembly execution use
`EWEBASSEMBLY` unless a more specific code is available.

## Concurrency and ordering

Each native platform uses a serial library-owned queue. Web calls without a
signal share one module Worker, a serialized request queue, and a cached
WebAssembly module. Calls with a signal use a dedicated Worker so cancellation
is operation-local. Apply an application-level concurrency and memory budget
for large browser inputs.

## Patch format

All four operations read or write `ENDSLEY/BSDIFF43` patches. Other bsdiff
variants, such as patches beginning with `BSDIFF40`, are not interchangeable.
