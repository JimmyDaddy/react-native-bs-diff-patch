export const PATCH_FORMAT = 'ENDSLEY/BSDIFF43';
export const PATCH_MANIFEST_VERSION = 1;
export const PATCH_BUNDLE_FORMAT =
  'react-native-bs-diff-patch/verified-bundle-v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class PatchToolkitError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PatchToolkitError';
    this.code = code;
  }
}

const ERROR_CATEGORIES = new Map([
  ['EABORTED', 'ABORTED'],
  ['ECANCELLED', 'ABORTED'],
  ['ERESOURCE', 'RESOURCE'],
  ['EINPUT_TOO_LARGE', 'RESOURCE'],
  ['EOUTPUT_TOO_LARGE', 'RESOURCE'],
  ['EINVAL', 'INVALID_ARGUMENT'],
  ['EINVALID_MANIFEST', 'INVALID_PATCH'],
  ['EPATCH', 'INVALID_PATCH'],
  ['ELEGACYFORMAT', 'INVALID_PATCH'],
  ['EBASELINEMISMATCH', 'VERIFICATION'],
  ['EPATCHMISMATCH', 'VERIFICATION'],
  ['ETARGETMISMATCH', 'VERIFICATION'],
  ['EDESTEXISTS', 'DESTINATION'],
  ['EUNSUPPORTED', 'UNSUPPORTED'],
]);

export function classifyPatchError(error) {
  const code =
    error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : 'EUNSPECIFIED';
  return {
    category: ERROR_CATEGORIES.get(code) || 'RUNTIME',
    code,
    message:
      error instanceof Error
        ? error.message
        : String(error || 'unknown patch error'),
    retryable: code === 'EABORTED' || code === 'ECANCELLED',
  };
}

function fail(code, message) {
  throw new PatchToolkitError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeArtifact(value, fieldName) {
  if (!isRecord(value)) {
    fail('EINVALID_MANIFEST', `${fieldName} must be an object`);
  }

  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    fail(
      'EINVALID_MANIFEST',
      `${fieldName}.bytes must be a non-negative safe integer`
    );
  }

  if (
    typeof value.sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.sha256.toLowerCase())
  ) {
    fail(
      'EINVALID_MANIFEST',
      `${fieldName}.sha256 must be a 64-character SHA-256 hex digest`
    );
  }

  const artifact = {
    bytes: value.bytes,
    sha256: value.sha256.toLowerCase(),
  };
  if (value.url !== undefined) {
    if (typeof value.url !== 'string' || value.url.length === 0) {
      fail('EINVALID_MANIFEST', `${fieldName}.url must be a non-empty string`);
    }
    artifact.url = value.url;
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.length === 0) {
      fail('EINVALID_MANIFEST', `${fieldName}.name must be a non-empty string`);
    }
    artifact.name = value.name;
  }
  return artifact;
}

function normalizeSignature(value) {
  if (!isRecord(value)) {
    fail('EINVALID_MANIFEST', 'signature must be an object');
  }
  if (typeof value.algorithm !== 'string' || value.algorithm.length === 0) {
    fail('EINVALID_MANIFEST', 'signature.algorithm must be a non-empty string');
  }
  if (typeof value.keyId !== 'string' || value.keyId.length === 0) {
    fail('EINVALID_MANIFEST', 'signature.keyId must be a non-empty string');
  }
  if (value.detached !== true) {
    fail('EINVALID_MANIFEST', 'signature.detached must be true');
  }
  return {
    algorithm: value.algorithm,
    detached: true,
    keyId: value.keyId,
  };
}

function normalizeDeclaredTargetBytes(value, fieldName) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(
      'EINVALID_MANIFEST',
      `${fieldName} must be an unsigned decimal string`
    );
  }
  return value;
}

export function canonicalJson(value) {
  const seen = new Set();

  function normalize(entry) {
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean'
    ) {
      return entry;
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) {
        fail('EINVALID_MANIFEST', 'canonical JSON rejects non-finite numbers');
      }
      return entry;
    }
    if (!Array.isArray(entry) && !isRecord(entry)) {
      fail('EINVALID_MANIFEST', `canonical JSON cannot encode ${typeof entry}`);
    }
    if (seen.has(entry)) {
      fail('EINVALID_MANIFEST', 'canonical JSON cannot encode cycles');
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      const normalized = entry.map(normalize);
      seen.delete(entry);
      return normalized;
    }
    const normalized = Object.create(null);
    for (const key of Object.keys(entry).sort()) {
      if (entry[key] !== undefined) {
        normalized[key] = normalize(entry[key]);
      }
    }
    seen.delete(entry);
    return normalized;
  }

  return JSON.stringify(normalize(value));
}

export function createPatchManifest(input) {
  return validatePatchManifest({
    version: PATCH_MANIFEST_VERSION,
    format: PATCH_FORMAT,
    baseline: input.baseline,
    patch: input.patch,
    target: input.target,
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.signature === undefined ? {} : { signature: input.signature }),
  });
}

export function validatePatchManifest(value) {
  if (!isRecord(value)) {
    fail('EINVALID_MANIFEST', 'manifest must be an object');
  }
  if (value.version !== PATCH_MANIFEST_VERSION) {
    fail(
      'EINVALID_MANIFEST',
      `manifest.version must be ${PATCH_MANIFEST_VERSION}`
    );
  }
  if (value.format !== PATCH_FORMAT) {
    fail('EINVALID_MANIFEST', `manifest.format must be ${PATCH_FORMAT}`);
  }

  const manifest = {
    version: PATCH_MANIFEST_VERSION,
    format: PATCH_FORMAT,
    baseline: normalizeArtifact(value.baseline, 'baseline'),
    patch: normalizeArtifact(value.patch, 'patch'),
    target: normalizeArtifact(value.target, 'target'),
  };
  if (value.releaseId !== undefined) {
    if (typeof value.releaseId !== 'string' || value.releaseId.length === 0) {
      fail('EINVALID_MANIFEST', 'releaseId must be a non-empty string');
    }
    manifest.releaseId = value.releaseId;
  }
  if (value.signature !== undefined) {
    manifest.signature = normalizeSignature(value.signature);
  }
  return manifest;
}

export function signingPayload(manifest) {
  const validated = validatePatchManifest(manifest);
  const { signature: _signature, ...unsigned } = validated;
  return canonicalJson(unsigned);
}

function normalizePatchCandidate(value, index) {
  if (!isRecord(value)) {
    fail('EINVALID_MANIFEST', `patches[${index}] must be an object`);
  }
  if (value.format !== PATCH_FORMAT) {
    fail(
      'EINVALID_MANIFEST',
      `patches[${index}].format must be ${PATCH_FORMAT}`
    );
  }
  return {
    format: PATCH_FORMAT,
    baseline: normalizeArtifact(value.baseline, `patches[${index}].baseline`),
    patch: normalizeArtifact(value.patch, `patches[${index}].patch`),
    declaredTargetBytes: normalizeDeclaredTargetBytes(
      value.declaredTargetBytes,
      `patches[${index}].declaredTargetBytes`
    ),
  };
}

export function createPatchBundle(input) {
  return validatePatchBundle({
    version: PATCH_MANIFEST_VERSION,
    format: PATCH_BUNDLE_FORMAT,
    target: input.target,
    full: input.full ?? input.target,
    patches: input.patches ?? [],
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.signature === undefined ? {} : { signature: input.signature }),
  });
}

export function validatePatchBundle(value) {
  if (!isRecord(value)) {
    fail('EINVALID_MANIFEST', 'bundle must be an object');
  }
  if (value.version !== PATCH_MANIFEST_VERSION) {
    fail(
      'EINVALID_MANIFEST',
      `bundle.version must be ${PATCH_MANIFEST_VERSION}`
    );
  }
  if (value.format !== PATCH_BUNDLE_FORMAT) {
    fail('EINVALID_MANIFEST', `bundle.format must be ${PATCH_BUNDLE_FORMAT}`);
  }
  if (!Array.isArray(value.patches)) {
    fail('EINVALID_MANIFEST', 'bundle.patches must be an array');
  }

  const bundle = {
    version: PATCH_MANIFEST_VERSION,
    format: PATCH_BUNDLE_FORMAT,
    target: normalizeArtifact(value.target, 'target'),
    full: normalizeArtifact(value.full, 'full'),
    patches: value.patches.map(normalizePatchCandidate),
  };
  if (bundle.full.sha256 !== bundle.target.sha256) {
    fail('EINVALID_MANIFEST', 'full.sha256 must match target.sha256');
  }
  if (bundle.full.bytes !== bundle.target.bytes) {
    fail('EINVALID_MANIFEST', 'full.bytes must match target.bytes');
  }
  for (let index = 0; index < bundle.patches.length; index += 1) {
    const candidate = bundle.patches[index];
    if (candidate.declaredTargetBytes !== String(bundle.target.bytes)) {
      fail(
        'EINVALID_MANIFEST',
        `patches[${index}].declaredTargetBytes must match target.bytes`
      );
    }
  }
  if (value.releaseId !== undefined) {
    if (typeof value.releaseId !== 'string' || value.releaseId.length === 0) {
      fail('EINVALID_MANIFEST', 'releaseId must be a non-empty string');
    }
    bundle.releaseId = value.releaseId;
  }
  if (value.signature !== undefined) {
    bundle.signature = normalizeSignature(value.signature);
  }
  return bundle;
}

export function selectPatch(bundleValue, options = {}) {
  const bundle = validatePatchBundle(bundleValue);
  const baselineSha256 =
    typeof options.baselineSha256 === 'string'
      ? options.baselineSha256.toLowerCase()
      : '';
  if (!SHA256_PATTERN.test(baselineSha256)) {
    fail('EINVAL', 'baselineSha256 must be a 64-character SHA-256 hex digest');
  }

  if (
    options.maxPatchBytes !== undefined &&
    (!Number.isSafeInteger(options.maxPatchBytes) || options.maxPatchBytes < 0)
  ) {
    fail('EINVAL', 'maxPatchBytes must be a non-negative safe integer');
  }
  if (
    options.maxPatchRatio !== undefined &&
    (!Number.isFinite(options.maxPatchRatio) ||
      options.maxPatchRatio < 0 ||
      options.maxPatchRatio > 1)
  ) {
    fail('EINVAL', 'maxPatchRatio must be between 0 and 1');
  }

  const candidate = bundle.patches.find(
    (entry) => entry.baseline.sha256 === baselineSha256
  );
  if (!candidate) {
    return {
      artifact: bundle.full,
      reason: 'BASELINE_NOT_FOUND',
      strategy: 'full',
    };
  }

  if (
    options.maxPatchBytes !== undefined &&
    candidate.patch.bytes > options.maxPatchBytes
  ) {
    return {
      artifact: bundle.full,
      candidate,
      reason: 'PATCH_BYTES_EXCEEDED',
      strategy: 'full',
    };
  }
  if (
    options.maxPatchRatio !== undefined &&
    candidate.patch.bytes / Math.max(1, bundle.full.bytes) >
      options.maxPatchRatio
  ) {
    return {
      artifact: bundle.full,
      candidate,
      reason: 'PATCH_RATIO_EXCEEDED',
      strategy: 'full',
    };
  }

  return {
    artifact: candidate.patch,
    candidate,
    reason: 'BASELINE_MATCH',
    strategy: 'patch',
  };
}

export function inspectPatchHeader(headerData, patchBytes) {
  if (!(headerData instanceof Uint8Array)) {
    fail('EINVAL', 'headerData must be a Uint8Array');
  }
  if (patchBytes === undefined) {
    patchBytes = headerData.byteLength;
  }
  if (!Number.isSafeInteger(patchBytes) || patchBytes < headerData.byteLength) {
    fail('EINVAL', 'patchBytes must include every provided header byte');
  }

  const headerBytes = Math.min(headerData.byteLength, 24);
  const magic = String.fromCharCode(
    ...headerData.subarray(0, Math.min(headerBytes, 16))
  );
  const legacyMagic = magic.slice(0, 8);
  const common = {
    headerBytes,
    patchBytes,
    payloadBytes: Math.max(0, patchBytes - 24),
  };
  if (headerBytes < 24) {
    return {
      ...common,
      declaredTargetBytes: null,
      format: legacyMagic === 'BSDIFF40' ? 'BSDIFF40' : 'UNKNOWN',
      issue: legacyMagic === 'BSDIFF40' ? 'LEGACY_FORMAT' : 'TRUNCATED_HEADER',
      valid: false,
    };
  }
  if (magic !== PATCH_FORMAT) {
    return {
      ...common,
      declaredTargetBytes: null,
      format: legacyMagic === 'BSDIFF40' ? 'BSDIFF40' : 'UNKNOWN',
      issue: legacyMagic === 'BSDIFF40' ? 'LEGACY_FORMAT' : 'INVALID_MAGIC',
      valid: false,
    };
  }
  if ((headerData[23] & 0x80) !== 0) {
    return {
      ...common,
      declaredTargetBytes: null,
      format: PATCH_FORMAT,
      issue: 'INVALID_TARGET_SIZE',
      valid: false,
    };
  }

  let targetBytes = 0n;
  for (let index = 23; index >= 16; index -= 1) {
    targetBytes = targetBytes * 256n + BigInt(headerData[index]);
  }
  return {
    ...common,
    declaredTargetBytes: targetBytes.toString(),
    format: PATCH_FORMAT,
    valid: true,
  };
}
