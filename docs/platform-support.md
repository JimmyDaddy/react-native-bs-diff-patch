# Platform support

## Capability matrix

| Capability                     | Android            | iOS                   | React Native Web   |
| ------------------------------ | ------------------ | --------------------- | ------------------ |
| File-path APIs                 | Yes                | Yes                   | No                 |
| Binary-data APIs               | No                 | No                    | Yes                |
| Legacy bridge                  | Yes                | Yes                   | N/A                |
| TurboModule / New Architecture | Yes                | Yes                   | N/A                |
| Background execution           | Serial executor    | Serial dispatch queue | Module Web Worker  |
| Patch format                   | `ENDSLEY/BSDIFF43` | `ENDSLEY/BSDIFF43`    | `ENDSLEY/BSDIFF43` |

The example application continuously exercises React Native 0.73.2. A direct
Android source-compatibility matrix compiles the New Architecture integration
against React Native 0.73.11, 0.74.7, and 0.86.0. The regular Android build also
compiles the 0.73 legacy architecture. These are tested versions, not a promise
that every intermediate or future React Native release is compatible.

## Android

Android selects a New Architecture package implementation based on the React
Native minor version:

- React Native 0.73 uses the compatible `TurboReactPackage` source set.
- React Native 0.74 and newer use `BaseReactPackage`.
- Legacy architecture builds use the classic `ReactPackage` implementation.

Native operations run on a module-owned single-thread executor. The packaged C
code is built with CMake and invoked through JNI.

## iOS

iOS autolinking registers `BsDiffPatch` for both architectures. New
Architecture codegen maps the module through `modulesProvider`, and the module
returns a generated TurboModule instance when `RCT_NEW_ARCH_ENABLED` is set.

Operations run on a dedicated serial dispatch queue rather than the main queue.

## React Native Web

The package has two Web entry mechanisms:

- `browser` points standard browser-aware bundlers to `web/index.mjs`.
- `src/index.web.ts` ensures Metro's platform resolver selects the Web API even
  though React Native gives the `react-native` package field higher priority.

The browser must support:

- WebAssembly.
- Module Web Workers.
- `ArrayBuffer` and typed arrays.
- `Blob.arrayBuffer()` when `Blob` inputs are used.
- `AbortController` when operation cancellation is used.

Webpack and Vite understand the standard
`new Worker(new URL(..., import.meta.url), { type: 'module' })` pattern. A Metro
Web setup must preserve module-worker URLs in its Web serializer.

The Web entry is browser-oriented rather than a Node.js filesystem adapter. It
does not make the native file-path APIs available in Node.js.

Calls without an `AbortSignal` share a module Worker and initialized
WebAssembly module. Calls with a signal receive a dedicated Worker so
cancellation is isolated to that operation. Both paths serialize work inside
their Worker; callers should still enforce an application memory budget.

## Server-side rendering

Importing the Web entry does not create a worker. Calling `diffBytes` or
`patchBytes` in an environment without `Worker` rejects with `EUNSUPPORTED`.
Invoke the binary APIs only in browser/client code.

## Patch exchange

Patch bytes are portable across Android, iOS, and Web. File access, transport,
storage, integrity verification, and final replacement remain application
responsibilities. See [Production recipes](./recipes.md) for a safe exchange
sequence.
