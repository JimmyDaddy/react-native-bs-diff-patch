import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createFilePatchManifest,
  convertBsdiff40File,
  diffFiles,
  inspectPatchFile,
  restoreVerified,
  verifyPatchFiles,
} from '../node/index.mjs';

const execFileAsync = promisify(execFile);
const tempDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'bsdiffpatch-node-test-')
);
const oldPath = path.join(tempDirectory, 'old.bin');
const newPath = path.join(tempDirectory, 'new.bin');
const patchPath = path.join(tempDirectory, 'update.patch');
const restoredPath = path.join(tempDirectory, 'restored.bin');
const cliRestoredPath = path.join(tempDirectory, 'cli-restored.bin');
const cliPath = path.resolve('bin/react-native-bs-diff-patch.mjs');
const invalidLegacyPath = path.join(tempDirectory, 'invalid-bsdiff40.patch');
const invalidConvertedPath = path.join(
  tempDirectory,
  'invalid-converted.patch'
);
const baselineDirectory = path.join(tempDirectory, 'releases');
const bundleDirectory = path.join(tempDirectory, 'bundle');
const mismatchedTargetPath = path.join(tempDirectory, 'mismatched-target.bin');
const limitedDiffPath = path.join(tempDirectory, 'limited-diff.patch');
const limitedDiffOutputPath = path.join(
  tempDirectory,
  'limited-diff-output.patch'
);
const limitedPatchPath = path.join(tempDirectory, 'limited-patch.bin');
const occupiedRestorePath = path.join(tempDirectory, 'occupied.bin');
const mismatchedRestorePath = path.join(
  tempDirectory,
  'mismatched-restore.bin'
);

try {
  const oldData = Buffer.from('old release payload\n'.repeat(128));
  const newData = Buffer.from(
    'new release payload\n'.repeat(96) + 'verified delta\n'.repeat(32)
  );
  await mkdir(baselineDirectory);
  await Promise.all([
    writeFile(oldPath, oldData),
    writeFile(newPath, newData),
    writeFile(mismatchedTargetPath, Buffer.concat([newData, Buffer.from('!')])),
    writeFile(path.join(baselineDirectory, 'v1.bin'), oldData),
    writeFile(
      path.join(baselineDirectory, 'v1.1.bin'),
      Buffer.concat([oldData.subarray(0, oldData.length - 1), Buffer.from('!')])
    ),
    writeFile(
      invalidLegacyPath,
      Buffer.concat([Buffer.from('BSDIFF40'), Buffer.alloc(24)])
    ),
  ]);

  await assert.rejects(
    convertBsdiff40File(invalidLegacyPath, invalidConvertedPath),
    (error) => error && error.code === 'ELEGACYFORMAT'
  );
  await assert.rejects(access(invalidConvertedPath), { code: 'ENOENT' });

  const progressEvents = [];
  const diffResult = await diffFiles(oldPath, newPath, patchPath, {
    onProgress: (event) => progressEvents.push(event),
  });
  assert.ok(diffResult.bytes > 24);
  assert.ok(
    progressEvents.some(
      (event) => event.phase === 'processing' && event.progress > 0
    )
  );
  const metadata = await inspectPatchFile(patchPath);
  assert.equal(metadata.valid, true);
  assert.equal(metadata.declaredTargetBytes, String(newData.byteLength));
  assert.equal(
    (await verifyPatchFiles(oldPath, patchPath, newPath)).verified,
    true
  );

  const manifest = await createFilePatchManifest(oldPath, patchPath, newPath);
  await writeFile(occupiedRestorePath, 'keep existing destination');
  await assert.rejects(
    restoreVerified(oldPath, patchPath, occupiedRestorePath, manifest),
    (error) => error && error.code === 'EDESTEXISTS'
  );
  assert.equal(
    await readFile(occupiedRestorePath, 'utf8'),
    'keep existing destination'
  );
  await assert.rejects(
    restoreVerified(oldPath, patchPath, mismatchedRestorePath, {
      ...manifest,
      target: { ...manifest.target, sha256: '0'.repeat(64) },
    }),
    (error) => error && error.code === 'ETARGETMISMATCH'
  );
  await assert.rejects(access(mismatchedRestorePath), { code: 'ENOENT' });
  assert.equal(
    (await readdir(tempDirectory)).some((name) =>
      name.startsWith('.bsdiffpatch-verified-')
    ),
    false
  );
  await assert.rejects(
    createFilePatchManifest(oldPath, patchPath, mismatchedTargetPath),
    (error) => error && error.code === 'ETARGETMISMATCH'
  );
  await assert.rejects(
    diffFiles(oldPath, newPath, limitedDiffPath, {
      maxInputBytes: oldData.byteLength - 1,
    }),
    (error) => error && error.code === 'ERESOURCE'
  );
  await assert.rejects(access(limitedDiffPath), { code: 'ENOENT' });
  await assert.rejects(
    diffFiles(oldPath, newPath, limitedDiffOutputPath, {
      maxOutputBytes: diffResult.bytes - 1,
    }),
    (error) => error && error.code === 'ERESOURCE'
  );
  await assert.rejects(access(limitedDiffOutputPath), { code: 'ENOENT' });
  await assert.rejects(
    restoreVerified(oldPath, patchPath, limitedPatchPath, manifest, {
      maxOutputBytes: newData.byteLength - 1,
    }),
    (error) => error && error.code === 'ERESOURCE'
  );
  await assert.rejects(access(limitedPatchPath), { code: 'ENOENT' });
  await restoreVerified(oldPath, patchPath, restoredPath, manifest);
  assert.deepEqual(await readFile(restoredPath), newData);

  const inspectResult = await execFileAsync(process.execPath, [
    cliPath,
    'inspect',
    patchPath,
    '--json',
  ]);
  assert.equal(JSON.parse(inspectResult.stdout).valid, true);
  await execFileAsync(process.execPath, [
    cliPath,
    'patch',
    oldPath,
    patchPath,
    '-o',
    cliRestoredPath,
  ]);
  assert.deepEqual(await readFile(cliRestoredPath), newData);
  const verifyResult = await execFileAsync(process.execPath, [
    cliPath,
    'verify',
    oldPath,
    patchPath,
    newPath,
  ]);
  assert.equal(JSON.parse(verifyResult.stdout).verified, true);

  const bundleResult = await execFileAsync(process.execPath, [
    cliPath,
    'bundle',
    '--from',
    baselineDirectory,
    '--to',
    newPath,
    '--out',
    bundleDirectory,
    '--max-ratio',
    '1',
    '--release-id',
    'v2',
  ]);
  assert.equal(JSON.parse(bundleResult.stdout).decisions.length, 2);
  const bundleManifest = JSON.parse(
    await readFile(path.join(bundleDirectory, 'bundle-manifest.json'), 'utf8')
  );
  assert.equal(
    bundleManifest.format,
    'react-native-bs-diff-patch/verified-bundle-v1'
  );
  assert.equal(bundleManifest.releaseId, 'v2');
} finally {
  await rm(tempDirectory, { force: true, recursive: true });
}

console.log('Node API and CLI tests passed');
