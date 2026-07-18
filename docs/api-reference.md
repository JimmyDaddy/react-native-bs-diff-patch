# API reference

The package exposes two platform-specific API families under one import path.

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

## `patch`

```ts
function patch(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number>;
```

Reconstructs the target file at `newFile`. Available on Android and iOS.

- `oldFile`: existing baseline file path.
- `newFile`: destination path that must not already exist.
- `patchFile`: existing compatible patch path.
- Resolves to `0` on success.

## `diffBytes`

```ts
type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput
): Promise<Uint8Array>;
```

Creates a binary patch in a Web Worker. Available on Web.

## `patchBytes`

```ts
function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput
): Promise<Uint8Array>;
```

Applies a compatible patch in a Web Worker and resolves to the reconstructed
bytes. Available on Web.

## Error shape

Rejected operations expose a normal `Error` with a string `code` when the
platform can classify the failure.

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

## Concurrency and ordering

Each native platform uses a serial library-owned queue. Every Web call creates
an isolated module Worker and terminates it after completion. Do not rely on
operations completing in submission order across separate Web calls.

## Patch format

All four operations read or write `ENDSLEY/BSDIFF43` patches. Other bsdiff
variants, such as patches beginning with `BSDIFF40`, are not interchangeable.
