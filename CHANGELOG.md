# Changelog

All notable changes to this project are documented in this file. Releases use
[Semantic Versioning](https://semver.org/) and are generated from Conventional
Commits by release-it.

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
