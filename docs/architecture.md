# Architecture and patch format

The library keeps one patch implementation and exposes it through three runtime
adapters.

## Execution paths

```text
React Native JavaScript
  -> typed public API
  -> TurboModule or legacy bridge
  -> platform job registry and serial operation boundary
  -> JNI / Objective-C++
  -> shared bsdiff + bzip2 C sources

React Native Web
  -> typed public API
  -> shared or cancellation-scoped module Web Worker
  -> Emscripten MEMFS
  -> the same bsdiff + bzip2 C sources compiled to WebAssembly
```

The worker boundaries keep expensive binary work away from the JavaScript/UI
thread. They do not make the algorithm free: callers remain responsible for
product-specific input-size and time limits.

Native jobs carry cancellation and progress callbacks into the C streams.
Outputs are written to an exclusive sibling temporary file and committed only
after the operation has flushed successfully. The legacy promise API shares the
same serial operation boundary but does not add implicit limits.

Web calls without an `AbortSignal` reuse one Worker and a cached Emscripten
module, avoiding repeated Worker and WebAssembly initialization. Calls with a
signal use a dedicated Worker; aborting the signal terminates only that Worker.
Every Worker serializes its own request queue and removes temporary MEMFS files
after each operation.

## Patch wire format

Patches begin with a 24-byte header:

| Bytes    | Content                                              |
| -------- | ---------------------------------------------------- |
| `0..15`  | ASCII magic `ENDSLEY/BSDIFF43`                       |
| `16..23` | Signed 64-bit target size in the format's byte order |
| `24..`   | bzip2-compressed control, diff, and extra data       |

The Web adapter validates the header and signature before entering the C patch
function. Native and Web operations use the same checked-in bsdiff and bzip2
sources, preserving cross-platform patch compatibility.

The format identifies the patch implementation, but not the intended baseline
or release. Applications should carry baseline and target digests in a trusted
manifest when distributing patches.

## WebAssembly packaging

`scripts/build-web-wasm.sh` invokes Emscripten with:

- an ES module factory;
- a single-file embedded WebAssembly payload;
- memory growth enabled;
- MEMFS and the `FS`/`ccall` runtime methods;
- exported `bsDiffFile` and `bsPatchFile` functions.

The generated `web/bsdiffpatch.mjs` is published with the package. Consumers do
not need Emscripten.

## Compatibility verification

A checked-in golden fixture proves that the Web implementation generates the
same deterministic patch bytes consumed by Android and iOS. Device runtime
tests also apply the golden Web patch and reject a truncated patch without
leaving partial output. The C patch core has sanitizer-backed malformed-input
fuzz coverage and never terminates the hosting process for invalid data.

## Reference Web benchmark

`yarn benchmark:web` runs deterministic one-byte-per-4-KiB changes and verifies
the restored result byte-for-byte. On an Apple M3 Pro with Node 26.5.0, the
checked-in 2026-07-19 reference recorded:

| Input  | Diff        | Patch    | Patch bytes |
| ------ | ----------- | -------- | ----------- |
| 1 MiB  | 158.5 ms    | 7.7 ms   | 110         |
| 10 MiB | 4,243.6 ms  | 57.5 ms  | 118         |
| 50 MiB | 30,697.5 ms | 285.2 ms | 203         |

These figures are a reproducible development baseline, not a device or browser
performance guarantee. Input similarity, CPU, browser, memory pressure, and
toolchain version materially affect results. The full machine-readable record
is in
[`benchmarks/web-wasm.json`](https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/benchmarks/web-wasm.json).

## Reference native-core benchmark

`yarn benchmark:native` compiles the same C sources embedded by Android and iOS,
runs each size in a fresh process, verifies the restored file, and records peak
resident memory. On the same Apple M3 Pro, the checked-in reference recorded:

| Input  | Diff        | Patch    | Patch bytes | Peak RSS  |
| ------ | ----------- | -------- | ----------- | --------- |
| 1 MiB  | 149.7 ms    | 4.8 ms   | 110         | 21.1 MiB  |
| 10 MiB | 4,103.3 ms  | 34.3 ms  | 118         | 193.6 MiB |
| 50 MiB | 31,852.3 ms | 199.7 ms | 203         | 960.4 MiB |

This isolates the native core from React Native scheduling and filesystem
wrappers; it is not an Android or iOS device score. Scheduled Linux and macOS
runs publish reports as CI artifacts so regressions can be compared on the same
runner family. The checked-in record is
[`benchmarks/native-core.json`](https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/benchmarks/native-core.json).

## Memory model

Native operations read the old and target files into process memory. Web calls
copy inputs before transferring them to a Worker, then copy results out of
MEMFS. Peak memory can therefore be several times larger than the input or
output size. The native reference reaches roughly nineteen times the input size
for this highly similar 50 MiB fixture, primarily because of the suffix array
and simultaneous file buffers.

For very large updates, configure native/Web operation limits (or check before
calling the legacy API), and consider a server-side or streaming update
strategy when the full files cannot safely fit in memory.

## Ownership boundaries

The library owns patch computation and platform scheduling. The application
owns:

- file selection, storage permissions, and temporary-file cleanup;
- patch transport and cache policy;
- authentication and cryptographic integrity checks;
- choosing concurrency, size, and time policies and passing supported limits;
- verification and atomic replacement of the restored output.

Keeping these responsibilities outside the patch engine lets applications use
their existing filesystem and release trust model.

## Compatibility rule

Patch compatibility is defined by the magic and implementation, not merely by
the generic name “bsdiff.” A `BSDIFF40` patch from another package is not a
supported input. Generate and apply patches with this library when crossing
Android, iOS, and Web.
