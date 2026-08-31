# Contributing

Contributions are always welcome, no matter how large or small!

We want this community to be friendly and respectful to each other. Please follow it in all your interactions with the project. Before contributing, please read the [code of conduct](./CODE_OF_CONDUCT.md).

## Development workflow

This project is a monorepo managed using [Yarn workspaces](https://yarnpkg.com/features/workspaces). It contains the following packages:

- The library package in the root directory.
- An example app in the `example/` directory.

To get started with the project, run `yarn` in the root directory to install the required dependencies for each package:

```sh
yarn
```

> Since the project relies on Yarn workspaces, you cannot use [`npm`](https://github.com/npm/cli) for development.

The [example app](/example/) demonstrates usage of the library. You need to run it to test any changes you make.

It is configured to use the local version of the library, so any changes you make to the library's source code will be reflected in the example app. Changes to the library's JavaScript code will be reflected in the example app without a rebuild, but native code changes will require a rebuild of the example app.

If you want to use Android Studio or XCode to edit the native code, you can open the `example/android` or `example/ios` directories respectively in those editors. To edit the Objective-C or Swift files, open `example/ios/BsDiffPatchExample.xcworkspace` in XCode and find the source files at `Pods > Development Pods > react-native-bs-diff-patch`.

To edit the Java or Kotlin files, open `example/android` in Android studio and find the source files at `react-native-bs-diff-patch` under `Android`.

You can use various commands from the root directory to work with the project.

To start the packager:

```sh
yarn example start
```

To run the example app on Android:

```sh
yarn example android
```

To run the example app on iOS:

```sh
yarn example ios
```

Make sure your code passes TypeScript and ESLint. Run the following to verify:

```sh
yarn typecheck
yarn lint
```

To fix formatting errors, run the following:

```sh
yarn lint --fix
```

Remember to add tests for your change if possible. Run the unit tests by:

```sh
yarn test
```

Web implementation changes should also pass:

```sh
yarn test:web
yarn test:web:browser
yarn test:web:metro
yarn test:sdk
```

`test:sdk` installs the prepared package tarball into an isolated consumer and
checks the public `/web` and `/toolkit` ESM entries, the production Vite
resource graph, and real byte round trips. It does not use a workspace link or
the registry's older package.

Documentation and site changes should pass:

```sh
yarn site:build
yarn site:test
yarn site:test:browser
```

Public English guides live in `docs/`, with their Chinese mirrors in
`docs/zh-CN/`. Keep both languages aligned when a change affects API behavior,
platform support, errors, or operational guidance.

### Commit message convention

We follow the [conventional commits specification](https://www.conventionalcommits.org/en) for our commit messages:

- `fix`: bug fixes, e.g. fix crash due to deprecated method.
- `feat`: new features, e.g. add new method to the module.
- `refactor`: code refactor, e.g. migrate from class components to hooks.
- `docs`: changes into documentation, e.g. add usage example for the module..
- `test`: adding or updating tests, e.g. add integration tests using detox.
- `chore`: tooling changes, e.g. change CI config.

Our pre-commit hooks verify that your commit message matches this format when committing.

### Linting and tests

[ESLint](https://eslint.org/), [Prettier](https://prettier.io/), [TypeScript](https://www.typescriptlang.org/)

We use [TypeScript](https://www.typescriptlang.org/) for type checking, [ESLint](https://eslint.org/) with [Prettier](https://prettier.io/) for linting and formatting the code, and [Jest](https://jestjs.io/) for testing.

Our pre-commit hooks verify that the linter and tests pass when committing.

### Publishing to npm

We use [release-it](https://github.com/release-it/release-it) to bump the
version, create the tag, and publish the GitHub Release. Publishing that release
starts `.github/workflows/npm-publish.yml`, which publishes to npm through OIDC
Trusted Publishing and verifies the package provenance. No long-lived npm token
is stored in GitHub.

Maintainers should run the quality gates, then create the release:

```sh
yarn prepare
yarn test:sdk
yarn typecheck
yarn lint
yarn test --runInBand
yarn pack --dry-run
yarn release --no-increment
```

`yarn prepare` runs the React Native Builder Bob output step, package
preparation, and `scripts/check-package-contract.mjs`. The same contract check
runs from the `prepack` lifecycle before a tarball is created. Run
`node scripts/check-package-contract.mjs` directly when inspecting a prepared
tree without rebuilding it. `yarn build:web` produces separate Node and
browser/Worker WASM modules: `web/bsdiffpatch.mjs` keeps NODEFS for Node and
the CLI, while `web/bsdiffpatch.browser.mjs` is the Node-free browser build.

When `package.json` already contains the prepared version, use
`yarn release --no-increment` so release-it does not bump it again. This command
creates the release commit, tag, and GitHub Release; the GitHub Release then
triggers the npm workflow. Run it only with explicit maintainer authorization.
A local 0.5.0 tarball is not a registry release; do not describe it as
published until the GitHub Release and npm provenance checks have completed.

The npm package already trusts the `JimmyDaddy/react-native-bs-diff-patch`
repository and the `npm-publish.yml` workflow. No npm-side configuration is
required for a release. The release tag must exactly match
`v<package.json version>`.

### Recovering a failed npm publication

For an existing tag and published GitHub Release (the example below uses
`v0.5.0`), recovery reuses that release. Classify a failed publication by
checking the registry first:

```sh
npm view react-native-bs-diff-patch@0.5.0 version \
  dist.attestations.provenance.predicateType --registry=https://registry.npmjs.org/
```

If `0.5.0` is already present, do not run `npm publish` again; complete only
the provenance and registry consumer checks. If the registry confirms an
explicit E404, fix the publishing tool or fixture, merge that fix into `main`,
and retry the existing release from `main`:

```sh
gh workflow run npm-publish.yml --ref main -f release_tag=v0.5.0
gh run list --workflow npm-publish.yml --limit 5
gh run watch <run-id>
```

See [Development and verification](./docs/development.md#recovering-a-failed-npm-publication)
for the exact tag checkout, commit, fixture, tree-cleanliness, OIDC, provenance,
and registry-smoke invariants. Do not move or delete the existing tag, run
release-it again for the same version, or change the npm Trusted Publisher
configuration.

### Scripts

The `package.json` file contains various scripts for common tasks:

- `yarn`: setup project by installing dependencies.
- `yarn typecheck`: type-check files with TypeScript.
- `yarn lint`: lint files with ESLint.
- `yarn test`: run unit tests with Jest.
- `yarn example start`: start the Metro server for the example app.
- `yarn example android`: run the example app on Android.
- `yarn example ios`: run the example app on iOS.
- `yarn build:web`: regenerate the checked-in WebAssembly bundle with Emscripten.
- `yarn test:web`: verify the WebAssembly patch format and round trip.
- `yarn test:web:browser`: exercise the public Web Worker API in Chrome.
- `yarn test:web:metro`: verify Metro resolves the React Native Web entry.
- `yarn test:sdk`: install the prepared tarball and verify `/web` and `/toolkit`
  from an isolated Vite consumer.
- `node scripts/check-package-contract.mjs`: verify exports, declarations,
  packed assets, and the Node-free browser resource graph.
- `yarn site:build`: render public Markdown and static site assets into `site-dist/`.
- `yarn site:test`: validate site structure and local links.
- `yarn site:test:browser`: verify the live Playground, docs, and mobile viewport.

### Sending a pull request

> **Working on your first pull request?** You can learn how from this _free_ series: [How to Contribute to an Open Source Project on GitHub](https://app.egghead.io/playlists/how-to-contribute-to-an-open-source-project-on-github).

When you're sending a pull request:

- Prefer small pull requests focused on one change.
- Verify that linters and tests are passing.
- Review the documentation to make sure it looks good.
- Follow the pull request template when opening a pull request.
- For pull requests that change the API or implementation, discuss with maintainers first by opening an issue.
