# Platform support

## Capability matrix

| Capability                     | Android            | iOS                   | React Native Web   |
| ------------------------------ | ------------------ | --------------------- | ------------------ |
| File-path APIs                 | Yes                | Yes                   | No                 |
| Binary-data APIs               | No                 | No                    | Yes                |
| Progress / cooperative cancel  | Native jobs        | Native jobs           | `AbortSignal`      |
| Input / output limits          | Native jobs        | Native jobs           | Binary options     |
| Legacy bridge                  | Yes                | Yes                   | N/A                |
| TurboModule / New Architecture | Yes                | Yes                   | N/A                |
| Background execution           | Serial executor    | Serialized worker     | Module Web Worker  |
| Patch format                   | `ENDSLEY/BSDIFF43` | `ENDSLEY/BSDIFF43`    | `ENDSLEY/BSDIFF43` |

The example application uses React Native 0.86.0 and exercises the New
Architecture on Android API 24/31 and iOS Simulator. Direct compatibility
fixtures compile the package against React Native 0.73.11 and 0.74.7; the 0.73
fixture also preserves the legacy-architecture boundary, while the full example
provides the current RN 0.86 build gate. React Native 0.82 and newer are New
Architecture only. These are tested versions, not a promise that every
intermediate or future release is compatible.

## Android

Android selects a New Architecture package implementation based on the React
Native minor version:

- React Native 0.73 uses the compatible `TurboReactPackage` source set.
- React Native 0.74 and newer use `BaseReactPackage`.
- Legacy architecture builds use the classic `ReactPackage` implementation.

Native operations run on a module-owned single-thread executor. Jobs add a
registry for queued/active cancellation, rate-limited progress events, limits,
and cleanup. The packaged C code is built with CMake and invoked through JNI.

## iOS

iOS autolinking registers `BsDiffPatch` for both architectures. New
Architecture codegen maps the module through `modulesProvider`, and the module
returns a generated TurboModule instance when `RCT_NEW_ARCH_ENABLED` is set.

Module methods use a concurrent dispatch queue so cancellation can be delivered
while work is active; actual patch work is serialized by a library semaphore.
The job registry is cancelled and cleaned when the module is invalidated.

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
Native job functions remain exported for a stable import shape but reject with
`EUNSUPPORTED` on Web.

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
