# Documentation

These Markdown files are the source of truth for the public documentation at
[bs-dff-patch.corerobin.com/docs](https://bs-dff-patch.corerobin.com/docs/).
The [Chinese documentation](./zh-CN/README.md) mirrors the same public guides.

## Choose a path

- **Integrating the library:** start with [Getting started](./getting-started.md),
  then check [Platform support](./platform-support.md).
- **Shipping an updater:** use [Production recipes](./recipes.md) and review the
  resource and trust boundaries in [Architecture](./architecture.md).
- **Investigating a failure:** find the rejected error in
  [Troubleshooting](./troubleshooting.md), then confirm its contract in the
  [API reference](./api-reference.md).
- **Contributing:** follow [Development](./development.md) and the repository
  [contribution guide](../CONTRIBUTING.md).

## Guides

- [Getting started](./getting-started.md) — installation and a first native or Web round trip.
- [API reference](./api-reference.md) — signatures, inputs, outputs, and errors.
- [Production recipes](./recipes.md) — integrity, cleanup, downloads, and cross-runtime workflows.
- [Platform support](./platform-support.md) — architecture and bundler behavior.
- [Architecture](./architecture.md) — execution paths and patch compatibility.
- [Native operations 0.3](./native-operations-v03.md) — resource limits,
  cancellation, progress, and atomic output contract.
- [Troubleshooting](./troubleshooting.md) — common integration failures.
- [Development](./development.md) — local builds, tests, WebAssembly, and release checks.

Implementation review records live under [`docs/review`](./review/) and are not
part of the end-user documentation navigation.
