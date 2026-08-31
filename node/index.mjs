import { createHash } from 'node:crypto';
import { access, link, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import createBsDiffPatchModule from '../web/bsdiffpatch.mjs';
import {
  createPatchManifest,
  inspectPatchHeader,
  validatePatchManifest,
} from '../toolkit/index.mjs';

let wasmOperationQueue = Promise.resolve();
let nodeModulePromise;
const PHASE_NAMES = ['reading', 'processing', 'writing'];

function runSerialized(operation) {
  const result = wasmOperationQueue.then(operation, operation);
  wasmOperationQueue = result.catch(() => {});
  return result;
}

function createNodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getNodeModule() {
  if (!nodeModulePromise) {
    const pendingModule = createBsDiffPatchModule({
      print: () => {},
      printErr: () => {},
    });
    nodeModulePromise = pendingModule;
    pendingModule.catch(() => {
      if (nodeModulePromise === pendingModule) {
        nodeModulePromise = undefined;
      }
    });
  }
  return nodeModulePromise;
}

function validateLimit(value, fieldName) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw createNodeError(
      'EINVAL',
      `${fieldName} must be a non-negative safe integer`
    );
  }
}

async function assertRegularFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw createNodeError('EINVAL', `not a regular file: ${filePath}`);
  }
  return fileStat;
}

async function enforceInputLimits(filePaths, maximumBytes) {
  validateLimit(maximumBytes, 'maxInputBytes');
  const stats = await Promise.all(filePaths.map(assertRegularFile));
  if (maximumBytes !== undefined) {
    const oversizedIndex = stats.findIndex(
      (fileStat) => fileStat.size > maximumBytes
    );
    if (oversizedIndex >= 0) {
      throw createNodeError(
        'ERESOURCE',
        `${filePaths[oversizedIndex]} is ${stats[oversizedIndex].size} bytes and exceeds the ${maximumBytes} byte limit`
      );
    }
  }
  return stats;
}

function operationResultError(result) {
  const codes = new Map([
    [-2, 'ERESOURCE'],
    [-3, 'ERESOURCE'],
    [-4, 'EABORTED'],
    [-5, 'EDESTEXISTS'],
  ]);
  return createNodeError(
    codes.get(result) || 'EWEBASSEMBLY',
    `native function returned ${result}`
  );
}

function ensureVirtualDirectory(module, mountPath) {
  if (!module.FS.analyzePath(mountPath).exists) {
    module.FS.mkdir(mountPath);
  }
}

function mountHostFile(module, mountName, hostPath) {
  const absolutePath = path.resolve(hostPath);
  const mountPath = `/node-${mountName}`;
  ensureVirtualDirectory(module, mountPath);
  module.FS.mount(
    module.NODEFS,
    { root: path.dirname(absolutePath) },
    mountPath
  );
  return {
    mountPath,
    virtualPath: `${mountPath}/${path.basename(absolutePath)}`,
  };
}

async function runHostFileOperation(
  operation,
  inputPaths,
  outputPath,
  options = {}
) {
  const module = await getNodeModule();
  if (!module.NODEFS) {
    throw createNodeError(
      'EUNSUPPORTED',
      'the WebAssembly bundle does not include NODEFS'
    );
  }

  const mounts = [];
  try {
    const virtualInputs = inputPaths.map((inputPath, index) => {
      const mount = mountHostFile(module, `input-${index}`, inputPath);
      mounts.push(mount);
      return mount.virtualPath;
    });
    const outputMount = mountHostFile(module, 'output', outputPath);
    mounts.push(outputMount);
    module.onProgress = (phase, progress) => {
      options.onProgress?.({
        operation,
        phase: PHASE_NAMES[phase] || 'processing',
        progress: Math.max(0, Math.min(1, progress)),
      });
    };

    const functionName =
      operation === 'diff'
        ? 'bsDiffFileWithProgressAndLimits'
        : 'bsPatchFileWithProgressAndLimits';
    const fileArgs =
      operation === 'diff'
        ? [...virtualInputs, outputMount.virtualPath]
        : [virtualInputs[0], outputMount.virtualPath, virtualInputs[1]];
    const args = [
      ...fileArgs,
      options.maxInputBytes ?? -1,
      options.maxOutputBytes ?? -1,
    ];
    const result = module.ccall(
      functionName,
      'number',
      ['string', 'string', 'string', 'number', 'number'],
      args
    );
    if (result !== 0) {
      throw operationResultError(result);
    }
  } finally {
    module.onProgress = undefined;
    for (const mount of mounts.reverse()) {
      try {
        module.FS.unmount(mount.mountPath);
      } catch {
        // A failed native operation may already have invalidated a mount.
      }
    }
  }
}

async function runHostConverter(inputPath, outputPath) {
  const module = await getNodeModule();
  if (!module.NODEFS) {
    throw createNodeError(
      'EUNSUPPORTED',
      'the WebAssembly bundle does not include NODEFS'
    );
  }
  const mounts = [];
  try {
    const inputMount = mountHostFile(module, 'convert-input', inputPath);
    const outputMount = mountHostFile(module, 'convert-output', outputPath);
    mounts.push(inputMount, outputMount);
    const result = module.ccall(
      'bsConvertBsdiff40File',
      'number',
      ['string', 'string'],
      [inputMount.virtualPath, outputMount.virtualPath]
    );
    if (result !== 0) {
      throw createNodeError(
        'ELEGACYFORMAT',
        `BSDIFF40 converter returned ${result}`
      );
    }
  } finally {
    for (const mount of mounts.reverse()) {
      try {
        module.FS.unmount(mount.mountPath);
      } catch {
        // Preserve the converter error if cleanup also fails.
      }
    }
  }
}

async function assertOutputAvailable(outputPath) {
  try {
    await access(outputPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw createNodeError('EDESTEXISTS', `output already exists: ${outputPath}`);
}

export function sha256Bytes(data) {
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(filePath) {
  const file = await open(filePath, 'r');
  const hash = createHash('sha256');
  try {
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

export async function describeFile(filePath, options = {}) {
  const fileStat = await assertRegularFile(filePath);
  return {
    bytes: fileStat.size,
    sha256: await sha256File(filePath),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.url === undefined ? {} : { url: options.url }),
  };
}

export async function inspectPatchFile(patchPath) {
  const file = await open(patchPath, 'r');
  try {
    const fileStat = await file.stat();
    const header = new Uint8Array(Math.min(24, fileStat.size));
    if (header.byteLength > 0) {
      await file.read(header, 0, header.byteLength, 0);
    }
    return inspectPatchHeader(header, fileStat.size);
  } finally {
    await file.close();
  }
}

export async function diffFiles(oldPath, newPath, outputPath, options = {}) {
  validateLimit(options.maxOutputBytes, 'maxOutputBytes');
  if (options.maxOutputBytes === 0) {
    throw createNodeError(
      'ERESOURCE',
      'a BSDIFF43 patch cannot fit within a zero-byte output limit'
    );
  }
  await assertOutputAvailable(outputPath);
  await enforceInputLimits([oldPath, newPath], options.maxInputBytes);
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await runSerialized(() =>
    runHostFileOperation('diff', [oldPath, newPath], outputPath, options)
  );
  const output = await describeFile(outputPath);
  return {
    bytes: output.bytes,
    outputPath,
    sha256: output.sha256,
  };
}

export async function patchFiles(oldPath, patchPath, outputPath, options = {}) {
  validateLimit(options.maxOutputBytes, 'maxOutputBytes');
  await assertOutputAvailable(outputPath);
  await enforceInputLimits([oldPath, patchPath], options.maxInputBytes);
  const metadata = await inspectPatchFile(patchPath);
  if (!metadata.valid) {
    throw createNodeError(
      metadata.issue === 'LEGACY_FORMAT' ? 'ELEGACYFORMAT' : 'EPATCH',
      `cannot apply patch: ${metadata.issue || 'invalid patch'}`
    );
  }
  if (
    options.maxOutputBytes !== undefined &&
    BigInt(metadata.declaredTargetBytes) > BigInt(options.maxOutputBytes)
  ) {
    throw createNodeError(
      'ERESOURCE',
      `output exceeds the configured ${options.maxOutputBytes} byte limit`
    );
  }
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await runSerialized(() =>
    runHostFileOperation('patch', [oldPath, patchPath], outputPath, options)
  );
  const output = await describeFile(outputPath);
  return {
    bytes: output.bytes,
    outputPath,
    sha256: output.sha256,
  };
}

export async function verifyPatchFiles(oldPath, patchPath, expectedPath) {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'react-native-bs-diff-patch-verify-')
  );
  const restoredPath = path.join(temporaryDirectory, 'restored.bin');
  try {
    const expected = await describeFile(expectedPath);
    const restored = await patchFiles(oldPath, patchPath, restoredPath);
    return {
      expectedBytes: expected.bytes,
      expectedSha256: expected.sha256,
      restoredBytes: restored.bytes,
      restoredSha256: restored.sha256,
      verified:
        restored.bytes === expected.bytes &&
        restored.sha256 === expected.sha256,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function createFilePatchManifest(
  oldPath,
  patchPath,
  targetPath,
  options = {}
) {
  const [baseline, patch, target, metadata] = await Promise.all([
    describeFile(oldPath, {
      name: options.baselineName ?? path.basename(oldPath),
      url: options.baselineUrl,
    }),
    describeFile(patchPath, {
      name: options.patchName ?? path.basename(patchPath),
      url: options.patchUrl,
    }),
    describeFile(targetPath, {
      name: options.targetName ?? path.basename(targetPath),
      url: options.targetUrl,
    }),
    inspectPatchFile(patchPath),
  ]);
  if (!metadata.valid) {
    throw createNodeError(
      metadata.issue === 'LEGACY_FORMAT' ? 'ELEGACYFORMAT' : 'EPATCH',
      `cannot create manifest for patch: ${metadata.issue || 'invalid patch'}`
    );
  }
  if (metadata.declaredTargetBytes !== String(target.bytes)) {
    throw createNodeError(
      'ETARGETMISMATCH',
      'patch header target size does not match the target artifact'
    );
  }
  return createPatchManifest({
    baseline,
    patch,
    target,
    releaseId: options.releaseId,
    signature: options.signature,
  });
}

export async function restoreVerified(
  oldPath,
  patchPath,
  outputPath,
  manifestValue,
  options = {}
) {
  const manifest = validatePatchManifest(manifestValue);

  const [baseline, patch] = await Promise.all([
    describeFile(oldPath),
    describeFile(patchPath),
  ]);
  if (
    baseline.bytes !== manifest.baseline.bytes ||
    baseline.sha256 !== manifest.baseline.sha256
  ) {
    throw createNodeError(
      'EBASELINEMISMATCH',
      'baseline does not match the verified patch manifest'
    );
  }
  if (
    patch.bytes !== manifest.patch.bytes ||
    patch.sha256 !== manifest.patch.sha256
  ) {
    throw createNodeError(
      'EPATCHMISMATCH',
      'patch does not match the verified patch manifest'
    );
  }

  await assertOutputAvailable(outputPath);
  const outputDirectory = path.dirname(path.resolve(outputPath));
  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(
    path.join(outputDirectory, '.bsdiffpatch-verified-')
  );
  const temporaryOutputPath = path.join(temporaryDirectory, 'restored.bin');
  try {
    const result = await patchFiles(oldPath, patchPath, temporaryOutputPath, {
      ...options,
      maxOutputBytes: Math.min(
        options.maxOutputBytes ?? Number.MAX_SAFE_INTEGER,
        manifest.target.bytes
      ),
    });
    if (
      result.bytes !== manifest.target.bytes ||
      result.sha256 !== manifest.target.sha256
    ) {
      throw createNodeError(
        'ETARGETMISMATCH',
        'restored output does not match the verified patch manifest'
      );
    }
    try {
      await link(temporaryOutputPath, outputPath);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw createNodeError(
          'EDESTEXISTS',
          `output already exists: ${outputPath}`
        );
      }
      throw error;
    }
    return { ...result, outputPath };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function convertBsdiff40File(inputPath, outputPath) {
  await assertOutputAvailable(outputPath);
  await assertRegularFile(inputPath);
  const metadata = await inspectPatchFile(inputPath);
  if (metadata.format !== 'BSDIFF40') {
    throw createNodeError('ELEGACYFORMAT', 'input is not a BSDIFF40 patch');
  }
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await runSerialized(() => runHostConverter(inputPath, outputPath));
  const converted = await describeFile(outputPath);
  return {
    bytes: converted.bytes,
    outputPath,
    sha256: converted.sha256,
  };
}
