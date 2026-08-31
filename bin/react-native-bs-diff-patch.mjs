#!/usr/bin/env node

import {
  constants as fsConstants,
  copyFile,
  mkdir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  createFilePatchManifest,
  convertBsdiff40File,
  describeFile,
  diffFiles,
  inspectPatchFile,
  patchFiles,
  verifyPatchFiles,
} from '../node/index.mjs';
import {
  canonicalJson,
  createPatchBundle,
  PATCH_FORMAT,
} from '../toolkit/index.mjs';

const HELP = `Verified Delta Pipeline for react-native-bs-diff-patch

Usage:
  react-native-bs-diff-patch diff <old> <new> -o <patch>
  react-native-bs-diff-patch patch <old> <patch> -o <new>
  react-native-bs-diff-patch inspect <patch> [--json]
  react-native-bs-diff-patch verify <old> <patch> <expected>
  react-native-bs-diff-patch manifest <old> <patch> <target> -o <manifest>
  react-native-bs-diff-patch convert <legacy.patch> -o <patch>
  react-native-bs-diff-patch bundle --from <releases> --to <target> [--out <dir>]

Bundle options:
  --max-ratio <0..1>  Use the full file when a patch exceeds this ratio (default: 0.85)
  --release-id <id>   Add a release identifier to the generated manifest
`;

function fail(message) {
  const error = new Error(message);
  error.code = 'EINVAL';
  throw error;
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const positionals = [];
  const options = {};
  const flags = new Set(['--json', '--help', '-h']);
  const aliases = new Map([
    ['-o', 'output'],
    ['--output', 'output'],
    ['--from', 'from'],
    ['--to', 'to'],
    ['--out', 'out'],
    ['--max-ratio', 'maxRatio'],
    ['--release-id', 'releaseId'],
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (flags.has(token)) {
      options[token.replace(/^-+/, '')] = true;
      continue;
    }
    if (aliases.has(token)) {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('-')) {
        fail(`${token} requires a value`);
      }
      options[aliases.get(token)] = value;
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      fail(`unknown option: ${token}`);
    }
    positionals.push(token);
  }
  return { command, options, positionals };
}

function print(value) {
  process.stdout.write(
    `${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`
  );
}

function requirePositionals(positionals, count, usage) {
  if (positionals.length !== count) {
    fail(`expected ${usage}`);
  }
}

function requireOutput(options) {
  if (!options.output) {
    fail('missing -o <output>');
  }
  return options.output;
}

async function makeBundle(options) {
  if (!options.from || !options.to) {
    fail('bundle requires --from <releases> and --to <target>');
  }
  const maximumRatio =
    options.maxRatio === undefined ? 0.85 : Number(options.maxRatio);
  if (!Number.isFinite(maximumRatio) || maximumRatio < 0 || maximumRatio > 1) {
    fail('--max-ratio must be between 0 and 1');
  }

  const targetPath = path.resolve(options.to);
  const outputDirectory = path.resolve(
    options.out ?? `${targetPath}.verified-bundle`
  );
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  try {
    await mkdir(outputDirectory);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const wrapped = new Error(
        `bundle output directory already exists: ${outputDirectory}`
      );
      wrapped.code = 'EDESTEXISTS';
      throw wrapped;
    }
    throw error;
  }

  try {
    const targetName = `full-${path.basename(targetPath)}`;
    const bundledTargetPath = path.join(outputDirectory, targetName);
    await copyFile(targetPath, bundledTargetPath, fsConstants.COPYFILE_EXCL);
    const target = await describeFile(bundledTargetPath, {
      name: targetName,
      url: targetName,
    });
    const baselineEntries = (
      await readdir(options.from, { withFileTypes: true })
    )
      .filter((entry) => entry.isFile())
      .sort((left, right) => left.name.localeCompare(right.name));
    if (baselineEntries.length === 0) {
      fail(`no baseline files found in ${options.from}`);
    }

    const patches = [];
    const decisions = [];
    for (let index = 0; index < baselineEntries.length; index += 1) {
      const entry = baselineEntries[index];
      const baselinePath = path.join(options.from, entry.name);
      const patchName = `${String(index + 1).padStart(3, '0')}-${
        entry.name
      }.patch`;
      const patchPath = path.join(outputDirectory, patchName);
      const result = await diffFiles(baselinePath, targetPath, patchPath);
      const baseline = await describeFile(baselinePath, { name: entry.name });
      const ratio = result.bytes / Math.max(1, target.bytes);

      if (ratio <= maximumRatio) {
        patches.push({
          format: PATCH_FORMAT,
          baseline,
          patch: {
            bytes: result.bytes,
            name: patchName,
            sha256: result.sha256,
            url: patchName,
          },
          declaredTargetBytes: String(target.bytes),
        });
        decisions.push({
          baseline: entry.name,
          patchBytes: result.bytes,
          ratio,
          strategy: 'patch',
        });
      } else {
        await rm(patchPath);
        decisions.push({
          baseline: entry.name,
          patchBytes: result.bytes,
          ratio,
          reason: 'PATCH_RATIO_EXCEEDED',
          strategy: 'full',
        });
      }
    }

    const bundle = createPatchBundle({
      full: target,
      patches,
      releaseId: options.releaseId,
      target,
    });
    const manifestPath = path.join(outputDirectory, 'bundle-manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(bundle, null, 2)}\n`, {
      flag: 'wx',
    });
    await writeFile(
      path.join(outputDirectory, 'bundle-manifest.canonical.json'),
      canonicalJson(bundle),
      { flag: 'wx' }
    );
    return {
      decisions,
      manifest: manifestPath,
      outputDirectory,
      patchCount: patches.length,
      targetBytes: target.bytes,
    };
  } catch (error) {
    await rm(outputDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function main() {
  const { command, options, positionals } = parseArguments(
    process.argv.slice(2)
  );
  if (!command || command === 'help' || options.help || options.h) {
    print(HELP.trimEnd());
    return;
  }

  if (command === 'diff') {
    requirePositionals(positionals, 2, 'diff <old> <new>');
    print(
      await diffFiles(positionals[0], positionals[1], requireOutput(options))
    );
    return;
  }
  if (command === 'patch') {
    requirePositionals(positionals, 2, 'patch <old> <patch>');
    print(
      await patchFiles(positionals[0], positionals[1], requireOutput(options))
    );
    return;
  }
  if (command === 'inspect') {
    requirePositionals(positionals, 1, 'inspect <patch>');
    const result = await inspectPatchFile(positionals[0]);
    print(
      options.json
        ? result
        : [
            `format: ${result.format}`,
            `valid: ${result.valid}`,
            `patch bytes: ${result.patchBytes}`,
            `target bytes: ${result.declaredTargetBytes ?? 'unknown'}`,
            ...(result.issue ? [`issue: ${result.issue}`] : []),
          ].join('\n')
    );
    return;
  }
  if (command === 'verify') {
    requirePositionals(positionals, 3, 'verify <old> <patch> <expected>');
    const result = await verifyPatchFiles(...positionals);
    print(result);
    if (!result.verified) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'manifest') {
    requirePositionals(positionals, 3, 'manifest <old> <patch> <target>');
    const manifest = await createFilePatchManifest(...positionals, {
      releaseId: options.releaseId,
    });
    await writeFile(
      requireOutput(options),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx' }
    );
    print(manifest);
    return;
  }
  if (command === 'convert') {
    requirePositionals(positionals, 1, 'convert <legacy.patch>');
    print(await convertBsdiff40File(positionals[0], requireOutput(options)));
    return;
  }
  if (command === 'bundle') {
    requirePositionals(positionals, 0, 'bundle options only');
    print(await makeBundle(options));
    return;
  }
  fail(`unknown command: ${command}`);
}

main().catch((error) => {
  const code = error && error.code ? error.code : 'ECLI';
  process.stderr.write(`[${code}] ${error.message || String(error)}\n`);
  process.exitCode = 1;
});
