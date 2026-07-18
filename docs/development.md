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
```

- `test:web` checks the WebAssembly round trip and patch magic.
- `test:web:browser` runs the public Worker API in Chrome.
- `test:web:metro` proves Metro selects the `.web` entry rather than the native
  TurboModule facade.

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

Android CI builds both architecture modes and runs the New Architecture device
round trip on its emulator matrix. iOS CI builds and tests legacy and New
Architecture configurations across the supported CocoaPods matrix.

For local example commands, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Publishing checklist

1. Run the core, Web, and site gates.
2. Inspect `npm pack --dry-run --ignore-scripts` and confirm `web/` is present.
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
