import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = 'bs-diff-patch-web';
export const REGISTRY_BASE_URL = 'https://registry.npmjs.org';
export const SLSA_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const sourceManifestPath = path.join(
  repositoryDirectory,
  'packages',
  'web',
  'package.json'
);

export class RegistryCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryCheckError';
  }
}

function fail(message) {
  throw new RegistryCheckError(message);
}

function parseTarString(value) {
  return value.toString('utf8').replace(/\0.*$/s, '');
}

function parseTarSize(header) {
  const value = parseTarString(header.subarray(124, 136)).trim();
  if (!/^[0-7]+$/.test(value)) {
    fail('The package tarball contains an invalid tar entry size.');
  }
  return Number.parseInt(value, 8);
}

function extractPackageJson(tarballBytes) {
  let archive;
  try {
    archive = gunzipSync(tarballBytes);
  } catch (error) {
    fail(
      `Unable to read the package tarball gzip stream: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = parseTarString(header.subarray(0, 100));
    const prefix = parseTarString(header.subarray(345, 500));
    const entryName = prefix ? `${prefix}/${name}` : name;
    const size = parseTarSize(header);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > archive.length) {
      fail('The package tarball contains a truncated tar entry.');
    }

    const type = header[156];
    if (entryName === 'package/package.json' && (type === 0 || type === 48)) {
      let manifest;
      try {
        manifest = JSON.parse(
          archive.subarray(contentStart, contentEnd).toString('utf8')
        );
      } catch (error) {
        fail(
          `The package tarball contains invalid package/package.json: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (
        !manifest ||
        typeof manifest !== 'object' ||
        Array.isArray(manifest)
      ) {
        fail('package/package.json must contain a JSON object.');
      }
      return manifest;
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  fail('The package tarball does not contain package/package.json.');
}

function isValidSemverIdentifier(value, { allowNumericLeadingZero } = {}) {
  if (!/^[0-9A-Za-z-]+$/.test(value)) {
    return false;
  }
  if (allowNumericLeadingZero || !/^\d+$/.test(value)) {
    return true;
  }
  return value === '0' || !/^0\d/.test(value);
}

export function isValidVersion(version) {
  if (typeof version !== 'string') {
    return false;
  }
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      version
    );
  if (!match) {
    return false;
  }
  const prereleaseValid =
    !match[4] ||
    match[4].split('.').every((part) => isValidSemverIdentifier(part));
  const buildValid =
    !match[5] ||
    match[5]
      .split('.')
      .every((part) =>
        isValidSemverIdentifier(part, { allowNumericLeadingZero: true })
      );
  return prereleaseValid && buildValid;
}

function readSourceManifest() {
  return readFile(sourceManifestPath, 'utf8').then((source) => {
    let manifest;
    try {
      manifest = JSON.parse(source);
    } catch (error) {
      fail(
        `Unable to read packages/web/package.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      fail('packages/web/package.json must contain a JSON object.');
    }
    if (manifest.name !== PACKAGE_NAME) {
      fail(`packages/web/package.json must name ${PACKAGE_NAME}.`);
    }
    if (!isValidVersion(manifest.version)) {
      fail('packages/web/package.json has an invalid semver version.');
    }
    return manifest;
  });
}

function assertCandidateManifest(manifest, sourceManifest) {
  if (manifest.name !== PACKAGE_NAME) {
    fail(`The package tarball must name ${PACKAGE_NAME}.`);
  }
  if (!isValidVersion(manifest.version)) {
    fail('The package tarball has an invalid semver version.');
  }
  if (manifest.version !== sourceManifest.version) {
    fail(
      `The package tarball version ${String(
        manifest.version
      )} does not match packages/web/package.json version ${
        sourceManifest.version
      }.`
    );
  }
}

export function hashTarball(tarballBytes) {
  const bytes = Buffer.from(tarballBytes);
  return {
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function readCandidateTarball(tarballPath) {
  let tarballBytes;
  try {
    tarballBytes = await readFile(tarballPath);
  } catch (error) {
    fail(
      `Unable to read candidate tarball ${tarballPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const manifest = extractPackageJson(tarballBytes);
  const sourceManifest = await readSourceManifest();
  assertCandidateManifest(manifest, sourceManifest);
  assertStandaloneManifest(manifest);
  return {
    bytes: tarballBytes,
    manifest,
    name: manifest.name,
    version: manifest.version,
    ...hashTarball(tarballBytes),
  };
}

export function registryMetadataUrl(name, version) {
  return `${REGISTRY_BASE_URL}/${encodeURIComponent(name)}/${encodeURIComponent(
    version
  )}`;
}

export function registryTarballUrl(name, version) {
  return `${REGISTRY_BASE_URL}/${encodeURIComponent(
    name
  )}/-/${encodeURIComponent(`${name}-${version}.tgz`)}`;
}

function getFetch(fetchImpl) {
  const candidate = fetchImpl || globalThis.fetch;
  if (typeof candidate !== 'function') {
    fail('This Node.js runtime does not provide fetch.');
  }
  return candidate;
}

async function fetchJson(url, fetchImpl) {
  let response;
  try {
    response = await getFetch(fetchImpl)(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    fail(
      `Unable to query the official npm registry: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!response || typeof response.status !== 'number') {
    fail('The npm registry returned an invalid response.');
  }
  if (response.status === 404) {
    return undefined;
  }
  if (response.status < 200 || response.status >= 300) {
    fail(`The npm registry query failed with HTTP ${response.status}.`);
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (error) {
    fail(
      `The npm registry returned invalid metadata: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('The npm registry returned invalid metadata.');
  }
  return metadata;
}

function assertRegistryMetadata(metadata, candidate) {
  if (
    metadata.name !== candidate.name ||
    metadata.version !== candidate.version
  ) {
    fail(
      'The npm registry metadata name/version does not match the candidate.'
    );
  }
  if (
    !metadata.dist ||
    typeof metadata.dist !== 'object' ||
    typeof metadata.dist.integrity !== 'string'
  ) {
    fail('The npm registry metadata is missing dist.integrity.');
  }
  if (metadata.dist.integrity !== candidate.integrity) {
    fail(
      'The npm registry dist.integrity does not match the candidate tarball.'
    );
  }
}

export function extractProvenance(metadata) {
  const predicateType =
    metadata?.dist?.attestations?.provenance?.predicateType || null;
  return {
    predicateType,
    slsa: predicateType === SLSA_PROVENANCE_PREDICATE,
  };
}

export async function fetchRegistryMetadata(candidate, { fetchImpl } = {}) {
  const metadata = await fetchJson(
    registryMetadataUrl(candidate.name, candidate.version),
    fetchImpl
  );
  return metadata;
}

function resultForCandidate(candidate, published, metadata) {
  const provenance = metadata
    ? extractProvenance(metadata)
    : { predicateType: null, slsa: false };
  return {
    name: candidate.name,
    version: candidate.version,
    integrity: candidate.integrity,
    sha256: candidate.sha256,
    published,
    provenance: provenance.slsa,
    provenancePredicateType: provenance.predicateType,
  };
}

export async function statusTarball(tarballPath, { fetchImpl } = {}) {
  const candidate = await readCandidateTarball(tarballPath);
  const metadata = await fetchRegistryMetadata(candidate, { fetchImpl });
  if (!metadata) {
    return resultForCandidate(candidate, false);
  }
  assertRegistryMetadata(metadata, candidate);
  assertStandaloneManifest(metadata);
  return resultForCandidate(candidate, true, metadata);
}

async function fetchRegistryTarball(candidate, { fetchImpl } = {}) {
  let response;
  try {
    response = await getFetch(fetchImpl)(
      registryTarballUrl(candidate.name, candidate.version),
      {
        headers: { accept: 'application/octet-stream' },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      }
    );
  } catch (error) {
    fail(
      `Unable to download the official npm registry tarball: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!response || typeof response.status !== 'number') {
    fail('The npm registry tarball response is invalid.');
  }
  if (response.status < 200 || response.status >= 300) {
    fail(
      `The npm registry tarball download failed with HTTP ${response.status}.`
    );
  }
  if (typeof response.arrayBuffer !== 'function') {
    fail('The npm registry tarball response has no byte body.');
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    fail(
      `Unable to read the npm registry tarball body: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function assertNoRuntimeDependencies(manifest) {
  const dependencyFields = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];
  for (const field of dependencyFields) {
    const value = manifest[field];
    if (
      Array.isArray(value)
        ? value.length > 0
        : value && Object.keys(value).length > 0
    ) {
      fail(`The published package must not contain ${field}.`);
    }
  }

  const allDependencyFields = [...dependencyFields, 'devDependencies'];
  for (const field of allDependencyFields) {
    const value = manifest[field];
    if (
      value &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'react-native')
    ) {
      fail(
        `The published package must not reference react-native in ${field}.`
      );
    }
  }
}

function assertStandaloneManifest(manifest) {
  assertNoRuntimeDependencies(manifest);
  for (const field of ['react-native', 'codegenConfig', 'bin']) {
    if (Object.hasOwn(manifest, field)) {
      fail(`The standalone package must not contain ${field}.`);
    }
  }
}

function assertPublishedManifest(manifest, candidate) {
  if (
    manifest.name !== candidate.name ||
    manifest.version !== candidate.version
  ) {
    fail('The downloaded package metadata does not match the candidate.');
  }
  assertStandaloneManifest(manifest);
}

export async function verifyTarball(
  tarballPath,
  { fetchImpl, requireProvenance = false } = {}
) {
  const candidate = await readCandidateTarball(tarballPath);
  const metadata = await fetchRegistryMetadata(candidate, { fetchImpl });
  if (!metadata) {
    fail(
      `The npm registry does not contain ${candidate.name}@${candidate.version}.`
    );
  }
  assertRegistryMetadata(metadata, candidate);
  assertStandaloneManifest(metadata);

  const registryBytes = await fetchRegistryTarball(candidate, { fetchImpl });
  const registryHashes = hashTarball(registryBytes);
  if (
    registryHashes.integrity !== candidate.integrity ||
    registryHashes.sha256 !== candidate.sha256
  ) {
    fail('The downloaded npm registry tarball does not match the candidate.');
  }
  assertPublishedManifest(extractPackageJson(registryBytes), candidate);

  const provenance = extractProvenance(metadata);
  if (requireProvenance && !provenance.slsa) {
    fail('The published package does not expose an SLSA provenance predicate.');
  }
  return {
    ...resultForCandidate(candidate, true, metadata),
    downloadedIntegrity: registryHashes.integrity,
    downloadedSha256: registryHashes.sha256,
  };
}

export const status = statusTarball;
export const verify = verifyTarball;

function usage() {
  return [
    'Usage: node scripts/web-package-registry.mjs status <tarball>',
    '   or: node scripts/web-package-registry.mjs verify <tarball> [--require-provenance]',
  ].join('\n');
}

async function runCli(argv) {
  const [command, tarballPath, option] = argv;
  if (!command || !tarballPath || argv.length > 3) {
    throw new RegistryCheckError(usage());
  }
  if (command === 'status') {
    if (option) {
      throw new RegistryCheckError(usage());
    }
    return statusTarball(tarballPath);
  }
  if (command === 'verify') {
    if (option && option !== '--require-provenance') {
      throw new RegistryCheckError(usage());
    }
    return verifyTarball(tarballPath, {
      requireProvenance: option === '--require-provenance',
    });
  }
  throw new RegistryCheckError(usage());
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
