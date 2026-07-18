# Architecture and patch format

The library keeps one patch implementation and exposes it through three runtime
adapters.

## Execution paths

```text
React Native JavaScript
  -> typed public API
  -> TurboModule or legacy bridge
  -> platform-owned serial worker queue
  -> JNI / Objective-C++
  -> shared bsdiff + bzip2 C sources

React Native Web
  -> typed public API
  -> module Web Worker
  -> Emscripten MEMFS
  -> the same bsdiff + bzip2 C sources compiled to WebAssembly
```

The worker boundaries keep expensive binary work away from the JavaScript/UI
thread. They do not make the algorithm free: callers remain responsible for
product-specific input-size and time limits.

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

## Memory model

Native operations read the old and target files into process memory. Web calls
copy inputs before transferring them to a Worker, then copy results out of
MEMFS. Peak memory can therefore be several times larger than the input or
output size.

For very large updates, enforce an application limit before calling the
library, and consider a server-side or streaming update strategy when the full
files cannot safely fit in memory.

## Ownership boundaries

The library owns patch computation and platform scheduling. The application
owns:

- file selection, storage permissions, and temporary-file cleanup;
- patch transport and cache policy;
- authentication and cryptographic integrity checks;
- concurrency, size, and time limits;
- verification and atomic replacement of the restored output.

Keeping these responsibilities outside the patch engine lets applications use
their existing filesystem and release trust model.

## Compatibility rule

Patch compatibility is defined by the magic and implementation, not merely by
the generic name “bsdiff.” A `BSDIFF40` patch from another package is not a
supported input. Generate and apply patches with this library when crossing
Android, iOS, and Web.
