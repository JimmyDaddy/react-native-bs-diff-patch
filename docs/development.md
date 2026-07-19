# Development and verification

## Prerequisites

- Node.js 20.19.4 or newer (the repository uses Node 22 in CI).
- Yarn 3.6.1 through the repository's checked-in Yarn release.
- Android Studio/JDK 17 for Android work.
- Xcode and CocoaPods for iOS work.
- Emscripten only when regenerating the checked-in WebAssembly bundle.

## Install

```sh
yarn install --immutable
```

The root package is the library and `example/` is the React Native consumer.

## Core quality gates

```sh
yarn prepare
yarn typecheck
yarn lint
yarn test --runInBand
yarn test:native-operations
```

## Web gates

```sh
yarn test:web
yarn test:web:browser
yarn test:web:metro
yarn test:package
```

- `test:web` checks the WebAssembly round trip and patch magic.
- `test:web:browser` runs the public Worker API in Chrome.
- `test:web:metro` proves Metro selects the `.web` entry rather than the native
  TurboModule facade.
- `test:package` installs the real tarball into a clean consumer and verifies
  browser, ESM, CommonJS, TypeScript, and optional-peer behavior.

## Native robustness and compatibility

```sh
FUZZ_RUNS=2000 yarn test:fuzz
scripts/test-rn-android-compatibility.sh 0.73.11 old
scripts/test-rn-android-compatibility.sh 0.73.11 new
scripts/test-rn-android-compatibility.sh 0.74.7 new
scripts/test-rn-android-compatibility.sh 0.86.0 new
scripts/test-rn-ios-compatibility.sh 0.73.11 old
scripts/test-rn-ios-compatibility.sh 0.73.11 new
scripts/test-rn-ios-compatibility.sh 0.74.7 new
scripts/test-rn-ios-compatibility.sh 0.86.0 new
```

The fuzz gate uses libFuzzer with AddressSanitizer and UndefinedBehaviorSanitizer
when the local Clang runtime provides it, otherwise it runs a deterministic
sanitizer corpus. The compatibility fixture compiles the actual Android module
sources against the selected React Native artifact instead of relying on
source-pattern assertions.
`test:native-operations` deterministically covers job progress, cancellation,
limits, malformed patches, atomic destination behavior, and temporary cleanup.

Run the repeatable Web performance baseline with:

```sh
yarn benchmark:web
BENCHMARK_OUTPUT=/tmp/web-wasm.json yarn benchmark:web
yarn benchmark:native
BENCHMARK_OUTPUT=/tmp/native-core.json yarn benchmark:native
```

The published-package canaries install directly from npm and intentionally use
current Vite and Expo toolchains. They are scheduled CI checks, not release
gates. Run them on demand with `yarn test:registry:vite` and
`yarn test:registry:expo`; set `PACKAGE_SPEC` to validate a tag or tarball.

## Dependency security

The published package has no runtime npm dependencies; React and React Native
are optional peers. Dependabot groups routine npm, Ruby, and Actions updates to
keep review volume bounded. The lockfile also pins patched leaf versions where
their APIs remain compatible.

```sh
yarn npm audit --all --recursive
```

The example and root toolchains track React Native 0.86, CLI 20.2, and
release-it 20. The upgrades remove the vulnerable `tmp` and `ip` chains; the
lockfile pins patched `tar`, `fast-xml-parser`, `socks`, and compatible leaf
overrides reported by the audit. Recheck GitHub Dependabot alerts after
dependency changes instead of assuming a lockfile override closes an advisory.

## Site and documentation

```sh
yarn site:build
yarn site:test
yarn site:test:browser
```

The static output is written to `site-dist/` and deployed by the GitHub Pages
workflow. Markdown under `docs/` is rendered into the site by the build script.
English pages live directly under `docs/`; Chinese mirrors live under
`docs/zh-CN/`. Keep both versions aligned when behavior or public API changes.

## Rebuild WebAssembly

After changing files under `cpp/`, activate an Emscripten toolchain and run:

```sh
yarn build:web
yarn test:web
yarn test:web:browser
```

Commit the regenerated `web/bsdiffpatch.mjs` with the C source change.

## Native verification

Android CI compiles the legacy boundary and New Architecture sources, then runs
the public API through RN 0.86 New Architecture on API 24 and 31 for pull
requests. iOS compiles the Pod compatibility fixtures and runs RN 0.86 New
Architecture on Simulator; React Native 0.82 and newer no longer provide a
legacy runtime. Device tests assert the active architecture, cross-platform
golden patches, malformed-patch rejection, job progress, cancellation, limits,
and output cleanup.

`native-benchmark.yml` is manual and scheduled infrastructure. It uploads
Linux/macOS JSON baselines but is intentionally not a pull-request blocker
because shared-runner performance is noisy.

For local example commands, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Publishing checklist

1. Run the core, Web, and site gates.
2. Run `yarn test:package` and inspect `npm pack --dry-run --ignore-scripts`.
3. Confirm public docs match the exported TypeScript declarations.
4. Confirm English and Chinese public guides describe the same behavior.
5. Use `yarn release` to create the version, tag, and GitHub Release. It does not
   publish directly to npm.
6. Publishing the GitHub Release starts `npm-publish.yml`. The workflow checks
   that the tag matches `package.json`, runs the release gates, publishes through
   npm Trusted Publishing, and verifies the provenance attestation.
7. Verify the npm package and GitHub Release before announcing availability.

The npm package's Trusted Publisher is already configured with these values:

- Provider: GitHub Actions.
- Organization or user: `JimmyDaddy`.
- Repository: `react-native-bs-diff-patch`.
- Workflow filename: `npm-publish.yml`.
- Environment: leave empty.

No npm-side change is required for a normal release, and the workflow does not
use a long-lived npm token.
