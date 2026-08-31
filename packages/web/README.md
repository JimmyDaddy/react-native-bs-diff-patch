# bs-diff-patch-web

`bs-diff-patch-web` is the standalone ESM package for browser, Vite, and
desktop WebView applications that need local binary patch operations. It does
not require React Native, Node.js, a Node sidecar, or native source code.

The package is built from the same checked-in C and bzip2 sources as
`react-native-bs-diff-patch`, but it is released independently. The Web package
uses the `web-v0.5.0` tag for its 0.5.0 release; the existing React Native
package keeps its separate `v0.5.0` release and remains supported.

## Install

```sh
npm install bs-diff-patch-web@^0.5.0
```

For pre-release verification, install the tarball produced by the package
build in a clean consumer:

```sh
npm install ./bs-diff-patch-web-0.5.0.tgz
```

The tarball command is a package verification path. It does not require a
workspace link, a source alias, or a private deep import.

## Public entries

| Import                      | Format | Purpose                                                                                                  |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `bs-diff-patch-web`         | ESM    | Browser and WebView byte APIs, Worker jobs, progress, cancellation, limits, inspection, and verification |
| `bs-diff-patch-web/toolkit` | ESM    | Platform-neutral manifest, bundle, candidate-selection, canonicalization, and header helpers             |

Both entries are ESM-only. This package intentionally does not provide a
CommonJS `require` entry, Node filesystem APIs, or a CLI. The existing
`react-native-bs-diff-patch` package remains the compatibility path for React
Native and for the `/node` entry and CLI.

The package has no runtime `dependencies` and no `peerDependencies`. Its
generated browser modules and Worker resources are included by the package
build. Consumers should import the package name and let Vite or another ESM
bundler follow the package exports; do not import repository paths or load the
engine from a CDN.

## Byte operations

```ts
import {
  diffBytes,
  inspectPatch,
  patchBytes,
  verifyPatch,
} from 'bs-diff-patch-web';

const encoder = new TextEncoder();
const baseline = encoder.encode('release=1\nfeature=native\n');
const target = encoder.encode('release=2\nfeature=native,web\n');

const patch = await diffBytes(baseline, target, {
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  onProgress: ({ phase, progress }) => console.log(phase, progress),
});

const metadata = await inspectPatch(patch);
if (!metadata.valid || metadata.format !== 'ENDSLEY/BSDIFF43') {
  throw new Error('unsupported patch header');
}

const restored = await patchBytes(baseline, patch, {
  maxOutputBytes: 32 * 1024 * 1024,
});
const verification = await verifyPatch(baseline, patch, target);

if (!verification.verified || restored.length !== target.length) {
  throw new Error('restored bytes do not match the target');
}
```

`diffBytes`, `patchBytes`, `inspectPatch`, and `verifyPatch` accept an
`ArrayBuffer`, any `ArrayBufferView` (including `DataView`), or a `Blob`/`File`.
Zero-byte binary inputs are valid. Native path APIs in the React Native
package separately reject empty path strings. Results are new `Uint8Array`
instances, and the Worker does not take ownership of caller buffers. Blob and
File inputs are mounted read-only through WORKERFS while the C core reads them;
the application still owns its object URLs and returned buffer references.

Keep patch bytes binary when storing or sending them. Converting arbitrary
patch bytes to UTF-8 can corrupt the patch.

## Jobs, cancellation, and limits

Use a job when the UI needs progress or an explicit Cancel action:

```ts
import { startPatch } from 'bs-diff-patch-web';

const job = startPatch(oldFile, patchFile, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  onProgress: renderProgress,
});

const unsubscribe = job.onProgress(renderProgress);
try {
  const restored = await job.result;
  consume(restored);
} catch (error) {
  if ((error as { code?: string }).code !== 'EABORTED') throw error;
} finally {
  unsubscribe();
}
```

`startDiff`, `startPatch`, `startDiffBytes`, and `startPatchBytes` use the same
binary job contract. A job with a signal or job wrapper uses a dedicated
Worker, so cancellation is isolated from other work. `result` resolves to a
new `Uint8Array`; a cancelled result rejects with `EABORTED`. `cancel()` itself
resolves only after `result` reaches a terminal state and Worker/listener
cleanup has completed. Calling `cancel()` repeatedly is safe, and cancelling
an already completed job does not change its settled result.

Calls without a signal share a serialized Worker queue. The SDK does not set
an aggregate application memory or concurrency budget; applications should
limit concurrent large jobs and release their own Blob URLs and buffer
references.

`maxInputBytes` applies independently to every supplied input. It is not a
combined input or total-process-memory limit. `maxOutputBytes` is checked
before a declared patch target is decompressed and allocated and again for the
produced result. Limits must be non-negative safe integers; invalid values
reject with `EINVAL`, while exceeded limits reject with `ERESOURCE`.

The current browser build retains Emscripten's configured 2 GiB maximum linear
memory setting. This is a build setting, not a WebAssembly-standard limit or a
universal hard ceiling for every engine. A browser, WebView, or device may
fail earlier because of its own WebAssembly or tab memory budget; detectable
allocation and memory-access failures are classified as `ERESOURCE`.

## Errors and patch format

Errors are ordinary `Error` values with a best-effort string `code`. Branch on
the code instead of diagnostic message text:

| Code           | Meaning                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `EINVAL`       | Invalid input type or option; zero-byte binary inputs remain valid        |
| `EUNSUPPORTED` | Worker or selected platform API is unavailable                            |
| `EABORTED`     | A Web signal or job was cancelled                                         |
| `ERESOURCE`    | An input/output limit or detectable runtime allocation limit was exceeded |
| `EPATCH`       | The patch header or payload is malformed or unsupported                   |
| `EWEBASSEMBLY` | Worker startup, resource loading, or another unclassified WASM failure    |

Runtime generation and application use `ENDSLEY/BSDIFF43`. Header inspection
recognizes `BSDIFF40` as `valid: false` with `issue: 'LEGACY_FORMAT'`; it does
not silently apply that format. Conversion and the Node CLI remain in
`react-native-bs-diff-patch`:

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
```

`inspectPatch` and `inspectPatchHeader` are structural header checks only.
`valid: true` does not prove that compressed payload blocks, the baseline, a
digest, or a signature is correct. `verifyPatch()` and the application's
trusted digest/signature policy are required before replacing application
data.

## Toolkit trust boundary

```ts
import {
  canonicalJson,
  createPatchBundle,
  createPatchManifest,
  selectPatch,
  signingPayload,
} from 'bs-diff-patch-web/toolkit';
```

The toolkit is platform-neutral. It does not read files, fetch URLs, compute
hashes, access private keys, verify signatures, or prove that bytes match a
manifest. It validates and normalizes caller-supplied structure; unknown
fields are dropped from normalized values.

`canonicalJson()` and `signingPayload()` produce deterministic signing inputs;
neither function performs a digital signature. Array cycles are rejected with
`EINVALID_MANIFEST`, and a literal `__proto__` object key is preserved during
canonicalization. `selectPatch()` validates selection options before finding a
baseline, returns the first exact digest match, and applies byte and ratio
budgets to that candidate. It does not search for the smallest patch. Invalid
budgets reject even when no baseline candidate matches.

## Packaging and CSP

Use the package name in application source and let the production bundler
follow its exports. The package build includes the browser Worker and WASM
resource graph; consumers do not need Emscripten or a separate `.wasm` file.
Run the production bundle with network access disabled to confirm that the
Worker and WASM load from same-origin package resources.

The minimum CSP additions for a browser or WebView are:

```text
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
```

Merge these directives with the application's existing policy. Do not add
ordinary `unsafe-eval`, use a CDN fallback, or move file authorization,
persistence, temporary files, or final replacement into this package. Tauri
WebView acceptance remains a downstream application test.

## Migration from the React Native package

Existing `react-native-bs-diff-patch` consumers can keep using its root,
`/web`, and `/toolkit` entries. Those entries are not deprecated and do not
need to be republished because this package exists. For a Web-only application
that wants no React Native package in its dependency graph:

1. install `bs-diff-patch-web@^0.5.0`;
2. change Web byte imports from `react-native-bs-diff-patch/web` to
   `bs-diff-patch-web`;
3. change toolkit imports from `react-native-bs-diff-patch/toolkit` to
   `bs-diff-patch-web/toolkit`;
4. keep Node filesystem operations, the CLI, and the BSDIFF40 converter on
   `react-native-bs-diff-patch`.

The byte ownership, Worker lifecycle, resource limits, errors, patch format,
and toolkit trust rules are the same across the two Web entry surfaces. This
package does not claim Tauri or downstream mobile acceptance; validate those
applications in their own environments.
