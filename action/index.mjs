import { appendFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import {
  createFilePatchManifest,
  describeFile,
  diffFiles,
} from '../node/index.mjs';

function input(name, options = {}) {
  const value = process.env[`INPUT_${name.toUpperCase()}`]?.trim();
  if (!value && options.required) {
    const error = new Error(`missing required action input: ${name}`);
    error.code = 'EINVAL';
    throw error;
  }
  return value || options.defaultValue;
}

async function setOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    for (const [name, value] of Object.entries(values)) {
      process.stdout.write(`${name}=${value}\n`);
    }
    return;
  }
  const lines = Object.entries(values)
    .map(([name, value]) => `${name}=${String(value).replace(/\r?\n/g, ' ')}`)
    .join('\n');
  await appendFile(outputPath, `${lines}\n`);
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

async function main() {
  const oldPath = input('OLD-FILE', { required: true });
  const newPath = input('NEW-FILE', { required: true });
  const patchPath = input('PATCH-FILE', { defaultValue: 'update.patch' });
  const manifestPath = input('MANIFEST-FILE', {
    defaultValue: 'patch-manifest.json',
  });
  const releaseId = input('RELEASE-ID');
  const maximumRatio = Number(
    input('MAX-PATCH-RATIO', { defaultValue: '0.85' })
  );
  if (!Number.isFinite(maximumRatio) || maximumRatio < 0 || maximumRatio > 1) {
    const error = new Error('max-patch-ratio must be between 0 and 1');
    error.code = 'EINVAL';
    throw error;
  }

  const patch = await diffFiles(oldPath, newPath, patchPath);
  const target = await describeFile(newPath);
  const ratio = patch.bytes / Math.max(1, target.bytes);
  const manifest = await createFilePatchManifest(oldPath, patchPath, newPath, {
    releaseId,
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
  });
  await setOutputs({
    'strategy': ratio <= maximumRatio ? 'patch' : 'full',
    'patch-file': patchPath,
    'manifest-file': manifestPath,
    'patch-bytes': patch.bytes,
    'target-bytes': target.bytes,
    'patch-ratio': ratio.toFixed(6),
    'savings-ratio': Math.max(0, 1 - ratio).toFixed(6),
  });
}

main().catch((error) => {
  const code = error && error.code ? error.code : 'EACTION';
  process.stderr.write(
    `::error title=${escapeWorkflowCommand(code)}::${escapeWorkflowCommand(
      error.message || error
    )}\n`
  );
  process.exitCode = 1;
});
