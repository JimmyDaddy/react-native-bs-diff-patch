# Web and desktop WebView SDK

This guide is for a browser, Tauri 2 WebView, or another TypeScript
application that needs the binary patch engine without installing React Native
or starting a Node sidecar. The SDK operates on bytes. A desktop application
still owns file dialogs, permissions, file reads and writes, temporary paths,
job policy, and final replacement in its Rust or platform layer.

## Use the public entries

The package keeps the React Native root entry for existing applications and
adds explicit ESM entries for browser consumers:

| Import | Module format | Use |
| --- | --- | --- |
| `react-native-bs-diff-patch/web` | ESM | Browser and WebView byte APIs, Worker jobs, metadata inspection and verification |
| `react-native-bs-diff-patch/toolkit` | ESM | Platform-neutral manifest, bundle and patch-header helpers |
| `react-native-bs-diff-patch` | Conditional | Existing React Native API; browser bundlers may select its browser condition |
| `react-native-bs-diff-patch/node` | ESM | Node filesystem operations and release tooling |

`/web` and `/toolkit` intentionally do not expose a separate CommonJS
`require` entry. Use a bundler or a native ESM import. The root package keeps
its existing CommonJS build for consumers that already depend on it; that
compatibility path does not make path-based native APIs available in a WebView.

The browser resource graph is part of the published package. The `/web`
entry loads the browser WASM module from `web/bsdiffpatch.browser.mjs` through
the module Worker graph. The Node entry keeps using `web/bsdiffpatch.mjs`,
which includes the Node filesystem support needed by `/node` and the CLI. Do
not alias one artifact to the other, import repository source paths, or add a
CDN fallback. Vite and other standard ESM bundlers should retain the
`new Worker(new URL('./worker.browser.mjs', import.meta.url), { type: 'module' })`
relationship.

## Minimal Vite or Tauri round trip

Install the package in the application that owns the WebView:

```sh
# Main install path for the 0.5.0 Web SDK:
npm install react-native-bs-diff-patch@^0.5.0
```

For pre-release verification of a locally prepared package, substitute its
tarball:

```sh
npm install ./react-native-bs-diff-patch-0.5.0.tgz
```

The registry's 0.4.x package predates the `/web` and `/toolkit` subpaths. Do not
use an unversioned registry install as a pre-release verification of those
entries.

The following code imports only the public Web entry and performs a real
byte-to-byte round trip. It does not read a path and does not require React,
React Native, Node, or a server endpoint:

```ts
import {
  diffBytes,
  inspectPatch,
  patchBytes,
  verifyPatch,
} from 'react-native-bs-diff-patch/web';

const encoder = new TextEncoder();
const baseline = encoder.encode('release=1\nfeature=native\n');
const target = encoder.encode('release=2\nfeature=native,web\n');

const controller = new AbortController();
const patch = await diffBytes(baseline, target, {
  signal: controller.signal,
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  onProgress: ({ phase, progress }) => {
    console.log(phase, progress);
  },
});

const metadata = await inspectPatch(patch);
if (!metadata.valid || metadata.format !== 'ENDSLEY/BSDIFF43') {
  throw new Error('unsupported patch header');
}

const restored = await patchBytes(baseline, patch, {
  maxOutputBytes: 32 * 1024 * 1024,
});
const verification = await verifyPatch(baseline, patch, target, {
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});

if (!verification.verified || restored.length !== target.length) {
  throw new Error('restored bytes do not match the target');
}
```

The same functions accept an `ArrayBuffer`, any `ArrayBufferView` (including a
`DataView`), or a `Blob`/`File`. A file selected by the browser can
therefore be passed directly:

```ts
const patch = await diffBytes(oldFile, newFile);
const patchBlob = new Blob([patch.slice().buffer as ArrayBuffer]);
const restored = await patchBytes(oldFile, patchBlob);
```

The result is a new `Uint8Array`. Typed-array offsets and lengths are honored,
and the input buffers remain usable after the call. The Worker does not take
ownership of caller buffers. For `Blob` and `File`, the Worker uses a
read-only WORKERFS mount while the C core reads the object; this avoids making
a full additional main-thread copy before the operation starts. Keep patch
bytes as binary data when storing or sending them; UTF-8 conversion corrupts
arbitrary patch bytes.

## Jobs, cancellation, and cleanup

Use a binary job when a UI needs progress, an explicit Cancel action, or a
separate operation lifecycle:

```ts
import { startPatchBytes } from 'react-native-bs-diff-patch/web';

const job = startPatchBytes(oldFile, patchFile, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  onProgress: renderProgress,
});
const unsubscribe = job.onProgress(renderProgress);

cancelButton.onclick = () => void job.cancel();
try {
  const restored = await job.result;
  consume(restored);
} catch (error) {
  if ((error as { code?: string }).code !== 'EABORTED') throw error;
} finally {
  unsubscribe();
}
```

`startDiff`, `startPatch`, `startDiffBytes`, and `startPatchBytes` are
binary job APIs in the Web entry. Their `result` resolves to a new
`Uint8Array`, and `cancel()` is operation-local. A job cancellation
terminates its dedicated Worker and rejects with `EABORTED`; it is not a
Promise timeout and does not interrupt another job. `cancel()` resolves only
after `result` reaches its terminal state and job cleanup has run. The `result`
promise itself rejects with `EABORTED`. Repeated cancellation is safe;
cancelling an already completed job does not change its settled result. A
cancellation or failure does not return a partial result.

The library removes operation-owned MEMFS files and listeners when a Worker
operation settles. There is no public `dispose()` call for the shared Worker:
calls without a signal reuse a module Worker and a cached WASM module, while a
call with a signal uses a dedicated Worker that is terminated after settle.
Applications still need to revoke their own `URL.createObjectURL()` URLs and
release references to returned buffers when those values are no longer needed.

Calls without a signal share one serialized Worker queue. Calls with a signal,
including the `start*` job wrappers, use dedicated Workers so cancellation is
isolated. The SDK does not enforce an aggregate application memory or
concurrency budget; cap concurrent jobs in the application before starting
large operations.

## Limits and memory behavior

`maxInputBytes` and `maxOutputBytes` are optional per-operation guards:

- `maxInputBytes` applies separately to every supplied input. It is not a
  total-memory or combined-input limit.
- `maxOutputBytes` applies to a generated patch or reconstructed output. For a
  patch operation, the declared target size is checked before decompression and
  output allocation; the produced result is checked as well.
- Limits must be non-negative safe integers. An invalid value rejects with
  `EINVAL`; an exceeded byte limit rejects with `ERESOURCE`.

The algorithm and WebAssembly adapter can use several times the input or
output size. The generated browser WASM build currently retains Emscripten's
configured maximum linear-memory setting of 2 GiB. This is a build setting,
not a limit from the WebAssembly standard or a universal hard ceiling for
every engine. It is not a promise that every browser, Tauri WebView, or device
can allocate that much; a host can fail earlier because of its WebAssembly
linear-memory or tab budget;
detectable allocation and memory-access failures are classified as
`ERESOURCE`, while other Worker or WebAssembly failures use
`EWEBASSEMBLY`. Treat the host's measured ceiling as an environment
constraint and record the tested input sizes for the target WebView. Do not
present `maxInputBytes` as a guarantee about total process memory. Recheck this
ceiling when the toolchain or generated WASM build changes.

## Errors and trust boundaries

Errors are ordinary `Error` values with a best-effort string `code`. Branch
on the code, not diagnostic message text:

| Code | Meaning |
| --- | --- |
| `EINVAL` | Malformed or unsupported input type, or invalid option (native empty or duplicate paths are also invalid; zero-byte binary inputs are valid) |
| `EUNSUPPORTED` | Web Worker or the selected platform API is unavailable |
| `EABORTED` | A Web signal or job was cancelled |
| `ERESOURCE` | An input/output bound or detectable runtime allocation limit was exceeded |
| `EPATCH` | The patch header or patch payload is malformed or unsupported |
| `EWEBASSEMBLY` | Worker startup, resource loading, or an unclassified WASM failure |

`inspectPatch()` is a cheap header inspection. It reads at most the 24-byte
header from a binary input and does not apply or authenticate the patch.
`inspectPatchHeader()` from `/toolkit` has the same header-only purpose for a
caller's `Uint8Array`. `valid: true` means that the magic and declared
target-size header fields are structurally acceptable; it does not prove that
compressed payload blocks are intact, that the baseline is correct, or that a
signature is valid. Use `verifyPatch()` and a trusted digest/signature policy
before replacing application data.

Runtime generation and application support `ENDSLEY/BSDIFF43`. A
`BSDIFF40` input is recognized by header inspection as `format:
'BSDIFF40'` with `valid: false` and `issue: 'LEGACY_FORMAT'`; it is not
silently applied. The existing Node converter remains available for offline
migration:

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
```

Verify the converted patch against its exact baseline and target before
shipping it. A patch's format does not identify its intended baseline.

## Toolkit manifests and candidate selection

The toolkit has no filesystem, network, or private-key access. It validates and
normalizes data supplied by the caller:

```ts
import {
  canonicalJson,
  createPatchBundle,
  createPatchManifest,
  selectPatch,
  signingPayload,
} from 'react-native-bs-diff-patch/toolkit';

const manifest = createPatchManifest({
  baseline: { bytes: 1000, sha256: baselineSha256 },
  patch: { bytes: 120, sha256: patchSha256, url: 'release.patch' },
  target: { bytes: 1100, sha256: targetSha256, url: 'app.bin' },
});
const bytesToSign = new TextEncoder().encode(signingPayload(manifest));
const canonical = canonicalJson(manifest);
```

`validatePatchManifest()` and `validatePatchBundle()` check structure, byte
counts, SHA-256-shaped strings, format, and bundle target consistency. They do
not read the named URLs, download artifacts, calculate hashes, verify a
signature, or prove that the bytes match the descriptors. Unknown fields are
discarded from the normalized return value, so keep application-specific data
outside the validated schema or explicitly preserve it in your own envelope.

`canonicalJson()` sorts object keys and omits `undefined` object properties.
`signingPayload()` returns canonical JSON with the manifest's detached
signature metadata removed. Neither function signs data: canonical JSON and a
signing payload are inputs to an external cryptographic signing system, not a
digital signature.

`selectPatch()` first validates the bundle and the selection options, then:

1. Lowercases the requested 64-character baseline SHA-256 and finds the first
   candidate with that exact digest.
2. Returns the full artifact with `BASELINE_NOT_FOUND` if no candidate matches.
3. Returns the full artifact with `PATCH_BYTES_EXCEEDED` when
   `maxPatchBytes` is exceeded.
4. Returns the full artifact with `PATCH_RATIO_EXCEEDED` when
   `candidate.patch.bytes / max(1, full.bytes)` is greater than
   `maxPatchRatio`.
5. Otherwise returns that first matching candidate with `BASELINE_MATCH` and
   strategy `patch`.

The helper does not search for the smallest patch or perform a restore. The
application must authenticate the manifest, download the selected artifact,
verify its digest, and then run `patchBytes()` and `verifyPatch()` as needed.

## Vite and Tauri packaging checklist

Use the package name in application source and let the bundler follow its
exports. A production build should contain the `/web` entry's module Worker
and browser WASM resource graph. With the single-file WASM build, the binary
payload is embedded in the generated browser module; consumers do not need to
copy an independent `.wasm` file or install Emscripten.

Before shipping, inspect the production bundle and run it from the built
assets, including with network access disabled. Confirm that:

- `react-native-bs-diff-patch/web` and `/toolkit` resolve from the installed
  tarball, with no workspace link, source alias, or private deep import;
- the Worker URL resolves to a packaged same-origin asset;
- browser WASM loads from the package resource graph, not a CDN;
- the production app can generate, apply and verify a patch after the network
  is disconnected;
- the target WebView's CSP permits the Worker and WebAssembly execution;
- Rust or another desktop layer owns file authorization and persistence, while
  JavaScript passes bytes to the SDK.

The minimum CSP additions for this SDK are:

```text
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
```

Merge those sources into the application's existing policy. Do not add
ordinary `unsafe-eval`, load the engine from a CDN, or loosen the policy as a
fallback. This guide documents the required policy; actual Tauri WebView
acceptance remains a downstream application test.

## Verification commands

From the repository, the relevant local checks are:

```sh
yarn test:web
yarn test:web:browser
yarn test:web:metro
yarn test:toolkit
yarn test:sdk
yarn typecheck
yarn site:build
yarn site:test
```

`yarn test:sdk` installs a prepared package tarball into an isolated consumer
and checks the public `/web` and `/toolkit` ESM entries, production Vite
resource loading and byte round trips. Registry smoke checks are a separate
post-release check. These checks do not constitute a Tauri device acceptance
test or a claim that registry smoke has passed.
