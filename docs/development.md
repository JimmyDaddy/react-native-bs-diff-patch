# Development and verification

## Prerequisites

- Node.js 18 or newer.
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
scripts/test-rn-android-compatibility.sh 0.73.11 new
scripts/test-rn-android-compatibility.sh 0.74.7 new
scripts/test-rn-android-compatibility.sh 0.86.0 new
scripts/test-rn-ios-compatibility.sh 0.73.11
scripts/test-rn-ios-compatibility.sh 0.74.7
scripts/test-rn-ios-compatibility.sh 0.86.0
```

The fuzz gate uses libFuzzer with AddressSanitizer and UndefinedBehaviorSanitizer
when the local Clang runtime provides it, otherwise it runs a deterministic
sanitizer corpus. The compatibility fixture compiles the actual Android module
sources against the selected React Native artifact instead of relying on
source-pattern assertions.

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

The legacy development toolchain currently retains three development-only
transitive families that cannot be safely forced to their advertised fixes:
`fast-xml-parser` requires a major upgrade outside CLI 12's range, `tar` requires
a major upgrade outside its parents' ranges, and `ip` has an open advisory with
no patched version. Keep these visible in GitHub alerts and remove them when the
0.73 example and Jest toolchains are retired or their parents publish
compatible upgrades.

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

Android CI builds both architecture modes, directly compiles New Architecture
sources against React Native 0.73.11, 0.74.7, and 0.86.0, and runs the New
Architecture device round trip on its emulator matrix. iOS CI compiles the Pod
against the same three React Native versions, then uses the CocoaPods version
locked in the example Gemfile to test both legacy and New Architecture modes.
The simulator asserts the active architecture in addition to cross-platform
golden patches and malformed-patch rejection.

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
