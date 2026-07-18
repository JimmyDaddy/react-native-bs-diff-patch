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

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput
): Promise<Uint8Array>;
```

Creates a binary patch in a Web Worker. Available on Web.

- Accepts `ArrayBuffer`, any typed-array or `DataView`, and `Blob`.
- Copies inputs, so buffers owned by the caller are not detached.
- Resolves to a new `Uint8Array` containing an `ENDSLEY/BSDIFF43` patch.

## `patchBytes`

```ts
function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput
): Promise<Uint8Array>;
```

Applies a compatible patch in a Web Worker and resolves to the reconstructed
bytes. Available on Web.

- Validates the patch header before invoking the WebAssembly core.
- Copies inputs and resolves to a new `Uint8Array`.
- Does not mutate `oldData` or `patchData`.

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
| `EWEBASSEMBLY` | WebAssembly loading, patch validation, or execution failed. |
| `EUNSPECIFIED` | An unclassified native exception occurred.                  |

Treat error messages as diagnostic text rather than a stable machine-readable
contract. Branch on `code` when recovery behavior differs.

Native validation stops before entering the C core. Web failures related to
Worker startup, patch validation, or WebAssembly execution use
`EWEBASSEMBLY` unless a more specific code is available.

## Concurrency and ordering

Each native platform uses a serial library-owned queue. Every Web call creates
an isolated module Worker and terminates it after completion. Do not rely on
operations completing in submission order across separate Web calls, and apply
an application-level concurrency limit for large browser inputs.

## Patch format

All four operations read or write `ENDSLEY/BSDIFF43` patches. Other bsdiff
variants, such as patches beginning with `BSDIFF40`, are not interchangeable.
