# Troubleshooting

Start with the error `code`, then confirm the runtime and input model:

| Symptom                          | First check                                      |
| -------------------------------- | ------------------------------------------------ |
| Native module cannot be found    | Rebuild the installed native application         |
| `ENOENT`, `EEXIST`, `EINVAL`     | Inspect path state before starting native work   |
| `EUNSUPPORTED`                   | Confirm that the correct API family was selected |
| `EABORTED`, `ERESOURCE`          | Check Web cancellation and byte limits           |
| `EDIFF`, `EPATCH`                | Check native I/O and patch integrity             |
| Worker or `EWEBASSEMBLY` failure | Check emitted Web assets, CSP, and patch magic   |
| High memory use                  | Enforce input and concurrency limits             |

## `TurboModuleRegistry.getEnforcing(...): 'BsDiffPatch' could not be found`

Rebuild the native application after installing the package. Metro reloads do
not add native modules to an already-installed binary.

- iOS: run `npx pod-install`, clean the Xcode build if needed, and rebuild.
- Android: stop the app, clean stale Gradle outputs if needed, and rebuild.
- Confirm the installed JavaScript package and native binary come from the same
  dependency state.

## `ENOENT`

A required file path does not exist. Verify that:

- paths are absolute and point to app-accessible storage;
- the old and new files exist before `diff`;
- the old file and patch exist before `patch`;
- asynchronous file writes have completed before starting the operation.

## `EEXIST`

The native destination already exists. The library avoids silently overwriting
patches or reconstructed files. Remove the stale output or use a unique path.

## `EINVAL`

Paths may be empty or duplicated, or Web binary input may not be an accepted
type. Old, new/output, and patch paths must all differ.

## `EUNSUPPORTED` on Web

The path-based `diff` and `patch` APIs are native-only. Use `diffBytes` and
`patchBytes` in React Native Web. If a binary API reports that Web Workers are
required, call it in browser/client code rather than during SSR.

## `EABORTED` or `ERESOURCE`

`EABORTED` means the `AbortSignal` supplied to a Web operation was already
aborted or became aborted while its dedicated Worker was active. `ERESOURCE`
means an input, generated patch, or declared restored output exceeded the
configured byte limit. Both are expected control-flow errors rather than a
WebAssembly failure.

## Worker failed to load

Confirm the bundler emits module-worker assets and that the deployed server
serves `.mjs` files as JavaScript. Strict Content Security Policy deployments
must permit same-origin workers and WebAssembly execution.

Open the browser network panel and confirm `worker.mjs`, `operations.mjs`, and
`bsdiffpatch.mjs` are returned with successful status codes rather than the
application HTML fallback.

## `EPATCH`, `EWEBASSEMBLY`, or corrupt patch

Check the first 16 bytes of the patch. Supported patches begin with
`ENDSLEY/BSDIFF43`. A truncated patch, a `BSDIFF40` patch, or unrelated binary
data will be rejected.

Native corrupt-patch failures use `EPATCH`; native patch-generation failures
use `EDIFF`. Web validation and C-core failures use `EWEBASSEMBLY` unless a
resource limit supplied the more specific `ERESOURCE` code. Failed native calls
remove any partial output owned by that operation.

## High memory use

The algorithm and adapters operate on complete in-memory buffers. Add a size
check before calling the library and avoid accepting arbitrary large untrusted
files. Web execution is off-main-thread but still consumes the tab's memory.

Unsignalled Web operations queue through a shared Worker. Signalled operations
use dedicated Workers for isolated cancellation. Debounce repeated user actions
and add an application-level budget if large calls can overlap.

## Restored output does not match

Confirm that the patch was generated from the exact baseline bytes being used
for restoration. Preserve patches as opaque binary data and avoid string or
JSON conversion. Verify the patch digest before applying it and the target
digest before replacing application data.

## Getting more diagnostics

When opening an issue, include:

- React Native and library versions;
- platform, architecture mode, and bundler;
- the rejected error `code` and message;
- minimal input sizes and path state without attaching sensitive files;
- whether the failure reproduces in the example app or online Playground.
