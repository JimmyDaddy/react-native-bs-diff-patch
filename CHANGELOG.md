# Changelog

All notable changes to this project are documented in this file. Releases use
[Semantic Versioning](https://semver.org/) and are generated from Conventional
Commits by release-it.

## [0.5.0](https://github.com/JimmyDaddy/react-native-bs-diff-patch/compare/v0.4.0...v0.5.0) (2026-08-31)

### Added

- add the explicit ESM `react-native-bs-diff-patch/web` entry for browser and
  desktop WebView byte operations, including typed declarations, Worker jobs,
  progress, cancellation, input/output limits, patch inspection, and
  byte-for-byte verification;
- publish a Node-free browser/Worker WebAssembly artifact alongside the
  Node-compatible artifact, while keeping the existing root React Native,
  Node, and CLI loading paths;
- add the ESM `react-native-bs-diff-patch/toolkit` entry for normalized
  manifests, multi-baseline bundles, canonical payloads, candidate selection,
  error classification, and header-only inspection;
- add tarball consumer checks for `/web` and `/toolkit`, production Vite
  resource loading, offline browser execution, and TypeScript resolution;
- add the Node release helpers, CLI, GitHub Action, and BSDIFF40 converter
  needed to prepare verified release artifacts without changing the runtime's
  `ENDSLEY/BSDIFF43` compatibility contract;
- add bilingual WebView integration, packaging, lifecycle, CSP, resource
  budget, trust-boundary, and release documentation.

### Compatibility and release boundaries

- keep the existing root CommonJS build, React Native conditional exports,
  native path API, and Node-compatible `web/bsdiffpatch.mjs`;
- keep `/web` and `/toolkit` ESM-only, and map the browser Worker graph to
  `web/bsdiffpatch.browser.mjs` without a CDN or Node runtime fallback;
- keep `BSDIFF40` as a header-inspection/conversion case only; runtime
  generation and application remain `ENDSLEY/BSDIFF43`;
- leave file authorization, persistence, and final replacement to downstream
  desktop applications. Tauri WebView acceptance remains a downstream test,
  and registry smoke checks remain a post-release validation step.

### Security and compatibility scope

- enforce a zero-byte output budget during C compressed output writes, and add
  control-flow guards for malformed or non-progressing patch streams;
- classify toolkit array cycles as `EINVALID_MANIFEST`, preserve a literal
  `__proto__` object key during canonicalization, and reject invalid selection
  budgets even when the requested baseline has no matching candidate;
- retain first-match candidate selection rather than silently choosing the
  smallest patch, while keeping the root React Native/Node compatibility paths
  and the `ENDSLEY/BSDIFF43` runtime format unchanged.

## [0.4.0](https://github.com/JimmyDaddy/react-native-bs-diff-patch/compare/v0.3.0...v0.4.0) (2026-07-23)

### Features

- add cross-platform `inspectPatch()` and `verifyPatch()` APIs for inspecting
  patch metadata and validating restored output byte-for-byte;
- add native runtime coverage for metadata, malformed patches, mismatches, and
  resource limits across Android and iOS;
- add a bilingual browser-local Binary Patch Toolkit for creating, applying,
  verifying, and inspecting patches without uploading files;
- add large-file native and Web benchmark baselines plus an evidence-backed
  roadmap for progress and streaming feasibility;
- refresh the bilingual README, documentation site, favicon, and social preview.

### Compatibility and validation

- keep the native fuzz harness buildable on both Linux and macOS while
  exercising the platform-specific atomic output path.

## [0.3.0](https://github.com/JimmyDaddy/react-native-bs-diff-patch/compare/v0.2.0...v0.3.0) (2026-07-20)

### Features

- add cancellable `startDiff()` and `startPatch()` jobs with progress events,
  input/output limits, stable error codes, and atomic no-overwrite output;
- implement the job registry and resource cleanup for Android and iOS while
  preserving the existing `diff()` and `patch()` APIs;
- provide the same controllable operation facade on React Native Web through
  WebAssembly module Workers;
- expand the bilingual Playground and documentation with progress,
  cancellation, limits, error handling, and platform differences.

### Compatibility, testing, and security

- upgrade the example and compatibility toolchain to React Native 0.86,
  React 19.2, RN CLI 20.2, and current release tooling;
- add deterministic native-core tests, Android API 24/31 and iOS Simulator
  runtime assertions, registry consumer canaries, and native benchmarks;
- update transitive development dependencies to remove all open Dependabot
  alerts from the default branch.

## [0.2.0](https://github.com/JimmyDaddy/react-native-bs-diff-patch/compare/v0.1.0...v0.2.0) (2026-07-19)

### Features

- harden cross-platform package and runtime
  ([#28](https://github.com/JimmyDaddy/react-native-bs-diff-patch/issues/28)).

## [0.1.0](https://github.com/JimmyDaddy/react-native-bs-diff-patch/releases/tag/v0.1.0) (2026-07-18)

### Features

- add React Native Web support backed by WebAssembly and module Workers;
- support both the React Native legacy and New Architecture runtimes;
- add Android and iOS device-level runtime assertions;
- publish through npm Trusted Publishing with provenance;
- add bilingual documentation, an interactive Playground, and GitHub Pages.
