# Verified Delta Pipeline

The package can be used as a client runtime, a release-side Node tool, or both.
The shared manifest and bundle schema connects patch generation, CDN selection,
and verified restore without owning transport or private signing keys.

## Node CLI

Install the package in a release workspace or run it through `npx`:

```sh
npx react-native-bs-diff-patch diff old.bin new.bin -o update.patch
npx react-native-bs-diff-patch inspect update.patch --json
npx react-native-bs-diff-patch verify old.bin update.patch new.bin
npx react-native-bs-diff-patch manifest \
  old.bin update.patch new.bin -o patch-manifest.json
```

The CLI refuses to overwrite existing output files. Node runs the same
WebAssembly core shipped for Web and mounts host paths through NODEFS, avoiding
an additional full-file copy in JavaScript. Diff generation still indexes
complete inputs inside the C/WASM core; patch application and verification use
the bounded streaming file path.

## Verified patch manifest

`createPatchManifest()` and `validatePatchManifest()` are available from the
environment-neutral toolkit entry:

```ts
import {
  canonicalJson,
  createPatchManifest,
  signingPayload,
} from 'react-native-bs-diff-patch/toolkit';

const manifest = createPatchManifest({
  baseline: { bytes: 1000, sha256: baselineSha256 },
  patch: { bytes: 120, sha256: patchSha256, url: 'update.patch' },
  target: { bytes: 1100, sha256: targetSha256, url: 'app.bin' },
});

const bytesToSign = new TextEncoder().encode(signingPayload(manifest));
const canonical = canonicalJson(manifest);
```

The library canonicalizes JSON, validates SHA-256 descriptors, and carries
detached-signature metadata. It never loads, stores, or manages a private key.
Authenticate the canonical manifest through the signing system already used by
your release pipeline.

## Verified restore in Node

The Node entry validates the baseline and patch before applying, then validates
the restored target before keeping it:

```ts
import {
  createFilePatchManifest,
  restoreVerified,
} from 'react-native-bs-diff-patch/node';

const manifest = await createFilePatchManifest(
  'old.bin',
  'update.patch',
  'new.bin'
);

await restoreVerified('old.bin', 'update.patch', 'restored.bin', manifest);
```

A baseline, patch, or target mismatch rejects with a verification error and
does not leave the requested output behind.

## Multi-baseline bundle

Generate one target release from every regular file in a baseline directory:

```sh
npx react-native-bs-diff-patch bundle \
  --from releases/ \
  --to dist/app.bin \
  --out dist/update-bundle \
  --max-ratio 0.85 \
  --release-id v1.5.0
```

The output contains:

- the full target fallback;
- one `ENDSLEY/BSDIFF43` patch for each cost-effective baseline;
- `bundle-manifest.json` for humans and CDNs;
- `bundle-manifest.canonical.json` for signing;
- a decision report showing patch or full-file selection.

At runtime, `selectPatch()` matches the trusted baseline SHA-256 and applies
optional patch-byte or patch-ratio budgets. A missing baseline or an
uneconomical patch selects the full artifact explicitly.

## GitHub Action

The repository includes a dependency-free action for one baseline:

```yaml
- uses: JimmyDaddy/react-native-bs-diff-patch@v0.5.0
  id: delta
  with:
    old-file: releases/v1.bin
    new-file: dist/app.bin
    patch-file: dist/update.patch
    manifest-file: dist/patch-manifest.json
    max-patch-ratio: '0.85'

- run: echo "strategy=${{ steps.delta.outputs.strategy }}"
```

Use the CLI `bundle` command when the release needs several baselines. The
action exposes patch size, target size, ratio, savings, and the selected
`patch` or `full` strategy as outputs.

## BSDIFF40 migration

The runtime continues to accept only `ENDSLEY/BSDIFF43`. Existing `BSDIFF40`
files can be converted offline without the baseline file:

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
npx react-native-bs-diff-patch inspect compatible.patch
```

Conversion validates the three BSDIFF40 compressed blocks, rewrites them into
the interleaved BSDIFF43 stream, and refuses malformed or existing outputs.
Verify the converted patch against its known baseline and target before
publishing it.

## Browser Release Planner

The [Release Planner](https://bs-dff-patch.corerobin.com/planner/) generates a
multi-baseline matrix and the same bundle manifest entirely in the browser. It
is intended for evaluation and debugging; use the CLI to reproduce production
artifacts in CI. Files selected in the planner are not uploaded.
