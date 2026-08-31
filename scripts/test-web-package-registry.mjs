import assert from 'node:assert/strict';
import { gzip } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  hashTarball,
  isValidVersion,
  PACKAGE_NAME,
  registryMetadataUrl,
  registryTarballUrl,
  statusTarball,
  verifyTarball,
} from './web-package-registry.mjs';

const gzipAsync = promisify(gzip);
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'bs-diff-patch-web-registry-')
);
const sourceManifest = JSON.parse(
  await readFile(
    new URL('../packages/web/package.json', import.meta.url),
    'utf8'
  )
);
assert.equal(sourceManifest.name, PACKAGE_NAME);
assert.equal(isValidVersion(sourceManifest.version), true);
assert.equal(isValidVersion('1.0.0+001'), true);
assert.equal(isValidVersion('1.0.0-01abc'), true);
assert.equal(isValidVersion('1.0.0-01'), false);
assert.equal(isValidVersion('1.0'), false);

function tarHeader(name, size, type = 48) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(
    `000000${size.toString(8).padStart(5, '0')}\0`,
    124,
    12,
    'ascii'
  );
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header[156] = type;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  return header;
}

async function createTarball(manifest, extraBytes = Buffer.from('fixture')) {
  const packageJson = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const padding = (value) => Buffer.alloc((512 - (value.length % 512)) % 512);
  const archive = Buffer.concat([
    tarHeader('package/package.json', packageJson.length),
    packageJson,
    padding(packageJson),
    tarHeader('package/fixture.bin', extraBytes.length),
    extraBytes,
    padding(extraBytes),
    Buffer.alloc(1024),
  ]);
  return gzipAsync(archive);
}

function jsonResponse(metadata) {
  return {
    status: 200,
    async json() {
      return metadata;
    },
  };
}

function bytesResponse(bytes) {
  const value = Buffer.from(bytes);
  return {
    status: 200,
    async arrayBuffer() {
      return value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength
      );
    },
  };
}

function createFetchResponder({
  metadata,
  tarball,
  metadataStatus = 200,
  tarballStatus = 200,
  error,
}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(typeof options.signal?.aborted, 'boolean');
    calls.push(url);
    if (error) {
      throw error;
    }
    if (url === registryMetadataUrl(manifest.name, manifest.version)) {
      return metadataStatus === 200
        ? jsonResponse(metadata)
        : {
            status: metadataStatus,
            async json() {
              return {};
            },
          };
    }
    if (url === registryTarballUrl(manifest.name, manifest.version)) {
      return tarballStatus === 200
        ? bytesResponse(tarball)
        : {
            status: tarballStatus,
            async arrayBuffer() {
              return new ArrayBuffer(0);
            },
          };
    }
    throw new Error(`Unexpected registry URL: ${url}`);
  };
  return { calls, fetchImpl };
}

const manifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  type: 'module',
};
const tarball = await createTarball(manifest);
const tarballPath = path.join(
  temporaryDirectory,
  `${manifest.name}-${manifest.version}.tgz`
);
await writeFile(tarballPath, tarball);
const hashes = hashTarball(tarball);
const matchingMetadata = {
  name: manifest.name,
  version: manifest.version,
  dist: { integrity: hashes.integrity },
};

async function assertRejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

try {
  {
    const fake = createFetchResponder({ metadata: {}, metadataStatus: 404 });
    const result = await statusTarball(tarballPath, {
      fetchImpl: fake.fetchImpl,
    });
    assert.equal(result.published, false);
    assert.equal(result.integrity, hashes.integrity);
    assert.equal(result.sha256, hashes.sha256);
    assert.deepEqual(fake.calls, [
      registryMetadataUrl(manifest.name, manifest.version),
    ]);
  }

  await assertRejects(
    statusTarball(tarballPath, {
      fetchImpl: createFetchResponder({
        metadata: {},
        error: new Error('offline'),
      }).fetchImpl,
    }),
    /official npm registry.*offline/
  );
  await assertRejects(
    statusTarball(tarballPath, {
      fetchImpl: createFetchResponder({ metadata: {}, metadataStatus: 503 })
        .fetchImpl,
    }),
    /HTTP 503/
  );
  await assertRejects(
    statusTarball(tarballPath, {
      fetchImpl: createFetchResponder({ metadata: {}, metadataStatus: 403 })
        .fetchImpl,
    }),
    /HTTP 403/
  );
  await assertRejects(
    statusTarball(tarballPath, {
      fetchImpl: createFetchResponder({
        metadata: { name: manifest.name, version: manifest.version },
      }).fetchImpl,
    }),
    /missing dist\.integrity/
  );
  await assertRejects(
    statusTarball(tarballPath, {
      fetchImpl: createFetchResponder({
        metadata: { ...matchingMetadata, dist: { integrity: 'sha512-wrong' } },
      }).fetchImpl,
    }),
    /dist\.integrity does not match/
  );
  await assertRejects(
    statusTarball(tarballPath, {
      fetchImpl: createFetchResponder({
        metadata: {
          ...matchingMetadata,
          dependencies: { 'react-native': '^0.86.0' },
        },
      }).fetchImpl,
    }),
    /must not contain dependencies/
  );

  {
    const invalidTarball = await createTarball({
      ...manifest,
      version: '1.0.0-01',
    });
    const invalidPath = path.join(
      temporaryDirectory,
      'bs-diff-patch-web-invalid-version.tgz'
    );
    await writeFile(invalidPath, invalidTarball);
    await assertRejects(
      statusTarball(invalidPath, {
        fetchImpl: createFetchResponder({ metadata: {}, metadataStatus: 404 })
          .fetchImpl,
      }),
      /invalid semver version/
    );
  }

  {
    const fake = createFetchResponder({
      metadata: matchingMetadata,
      tarball: Buffer.from('wrong tarball'),
    });
    await assertRejects(
      verifyTarball(tarballPath, { fetchImpl: fake.fetchImpl }),
      /does not match the candidate/
    );
    assert.deepEqual(fake.calls, [
      registryMetadataUrl(manifest.name, manifest.version),
      registryTarballUrl(manifest.name, manifest.version),
    ]);
  }

  {
    const fake = createFetchResponder({
      metadata: matchingMetadata,
      tarball,
    });
    const result = await statusTarball(tarballPath, {
      fetchImpl: fake.fetchImpl,
    });
    assert.equal(result.published, true);
    assert.equal(result.provenance, false);
    const verified = await verifyTarball(tarballPath, {
      fetchImpl: fake.fetchImpl,
    });
    assert.equal(verified.published, true);
    assert.equal(verified.downloadedIntegrity, hashes.integrity);
    assert.equal(verified.provenance, false);
    await assertRejects(
      verifyTarball(tarballPath, {
        fetchImpl: fake.fetchImpl,
        requireProvenance: true,
      }),
      /does not expose an SLSA provenance predicate/
    );
  }

  {
    const fake = createFetchResponder({
      metadata: {
        ...matchingMetadata,
        dist: {
          integrity: hashes.integrity,
          attestations: {
            provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
          },
        },
      },
      tarball,
    });
    const verified = await verifyTarball(tarballPath, {
      fetchImpl: fake.fetchImpl,
      requireProvenance: true,
    });
    assert.equal(verified.provenance, true);
    assert.equal(
      verified.provenancePredicateType,
      'https://slsa.dev/provenance/v1'
    );
  }

  {
    const dependencyTarball = await createTarball({
      ...manifest,
      dependencies: { 'react-native': '^0.86.0' },
    });
    const dependencyPath = path.join(
      temporaryDirectory,
      'bs-diff-patch-web-with-dependency.tgz'
    );
    await writeFile(dependencyPath, dependencyTarball);
    const fake = createFetchResponder({
      metadata: {
        name: manifest.name,
        version: manifest.version,
        dist: { integrity: hashTarball(dependencyTarball).integrity },
      },
      tarball: dependencyTarball,
    });
    await assertRejects(
      verifyTarball(dependencyPath, { fetchImpl: fake.fetchImpl }),
      /must not contain dependencies/
    );
  }

  console.log('web package registry checks passed');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
