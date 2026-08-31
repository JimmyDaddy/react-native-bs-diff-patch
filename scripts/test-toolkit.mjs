import assert from 'node:assert/strict';

import {
  canonicalJson,
  classifyPatchError,
  createPatchBundle,
  createPatchManifest,
  inspectPatchHeader,
  PatchToolkitError,
  selectPatch,
  signingPayload,
  validatePatchBundle,
  validatePatchManifest,
} from '../toolkit/index.mjs';

const hashes = {
  baseline: '1'.repeat(64),
  patch: '2'.repeat(64),
  target: '3'.repeat(64),
};
const manifest = createPatchManifest({
  baseline: { bytes: 1000, sha256: hashes.baseline },
  patch: { bytes: 120, sha256: hashes.patch, url: 'release.patch' },
  releaseId: 'v5',
  signature: {
    algorithm: 'ed25519',
    detached: true,
    keyId: 'release-2026',
  },
  target: { bytes: 1100, sha256: hashes.target },
});

assert.deepEqual(validatePatchManifest(manifest), manifest);
assert.equal(
  canonicalJson({ z: 1, a: { y: true, b: 'value' } }),
  '{"a":{"b":"value","y":true},"z":1}'
);
assert.ok(!signingPayload(manifest).includes('signature'));
assert.deepEqual(
  classifyPatchError(
    Object.assign(new Error('too large'), { code: 'ERESOURCE' })
  ),
  {
    category: 'RESOURCE',
    code: 'ERESOURCE',
    message: 'too large',
    retryable: false,
  }
);

const bundle = createPatchBundle({
  full: { bytes: 1100, sha256: hashes.target, url: 'full.bin' },
  patches: [
    {
      baseline: manifest.baseline,
      declaredTargetBytes: '1100',
      format: 'ENDSLEY/BSDIFF43',
      patch: manifest.patch,
    },
  ],
  target: manifest.target,
});
assert.deepEqual(validatePatchBundle(bundle), bundle);
assert.equal(
  selectPatch(bundle, {
    baselineSha256: hashes.baseline,
    maxPatchRatio: 0.2,
  }).strategy,
  'patch'
);
assert.deepEqual(selectPatch(bundle, { baselineSha256: '4'.repeat(64) }), {
  artifact: bundle.full,
  reason: 'BASELINE_NOT_FOUND',
  strategy: 'full',
});
assert.equal(
  selectPatch(bundle, {
    baselineSha256: hashes.baseline,
    maxPatchRatio: 0.05,
  }).reason,
  'PATCH_RATIO_EXCEEDED'
);
assert.throws(
  () => validatePatchManifest({ ...manifest, version: 2 }),
  (error) => error && error.code === 'EINVALID_MANIFEST'
);
assert.throws(
  () =>
    validatePatchBundle({
      ...bundle,
      patches: [
        {
          ...bundle.patches[0],
          declaredTargetBytes: '1099',
        },
      ],
    }),
  (error) => error && error.code === 'EINVALID_MANIFEST'
);

// Validation normalizes JSON metadata only; unknown fields are not trusted.
const decorated = structuredClone(manifest);
decorated.extra = 'not part of the contract';
decorated.baseline.extra = true;
decorated.signature.extra = 'not a signature';
assert.deepEqual(validatePatchManifest(decorated), manifest);
assert.equal(
  decorated.baseline.extra,
  true,
  'validation must not mutate input'
);
assert.deepEqual(
  validatePatchManifest(JSON.parse(JSON.stringify(manifest))),
  manifest
);
assert.deepEqual(
  validatePatchBundle(JSON.parse(JSON.stringify(bundle))),
  bundle
);
const decoratedBundle = structuredClone(bundle);
decoratedBundle.unknown = true;
decoratedBundle.patches[0].unknown = true;
assert.deepEqual(validatePatchBundle(decoratedBundle), bundle);

function throwsCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof PatchToolkitError && error.code === code
  );
}

for (const invalidBytes of [
  -1,
  1.5,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  throwsCode(
    () =>
      validatePatchManifest({
        ...manifest,
        baseline: { ...manifest.baseline, bytes: invalidBytes },
      }),
    'EINVALID_MANIFEST'
  );
}
for (const invalidHash of ['', 'a'.repeat(63), 'g'.repeat(64), 12, null]) {
  throwsCode(
    () =>
      validatePatchManifest({
        ...manifest,
        target: { ...manifest.target, sha256: invalidHash },
      }),
    'EINVALID_MANIFEST'
  );
}
for (const signature of [
  null,
  { algorithm: 'ed25519', keyId: 'key', detached: false },
  { algorithm: '', keyId: 'key', detached: true },
]) {
  throwsCode(
    () => validatePatchManifest({ ...manifest, signature }),
    'EINVALID_MANIFEST'
  );
}
throwsCode(
  () => validatePatchBundle({ ...bundle, full: { ...bundle.full, bytes: 5 } }),
  'EINVALID_MANIFEST'
);
throwsCode(
  () => validatePatchBundle({ ...bundle, patches: null }),
  'EINVALID_MANIFEST'
);

// First baseline match wins. A later, smaller candidate is deliberately not selected.
const orderedBundle = createPatchBundle({
  ...bundle,
  patches: [
    bundle.patches[0],
    { ...bundle.patches[0], patch: { ...manifest.patch, bytes: 1 } },
  ],
});
assert.equal(
  selectPatch(orderedBundle, { baselineSha256: hashes.baseline }).artifact
    .bytes,
  120
);
assert.equal(
  selectPatch(orderedBundle, {
    baselineSha256: hashes.baseline,
    maxPatchBytes: 119,
  }).reason,
  'PATCH_BYTES_EXCEEDED'
);
assert.equal(
  selectPatch(bundle, {
    baselineSha256: hashes.baseline,
    maxPatchBytes: 120,
    maxPatchRatio: 120 / 1100,
  }).strategy,
  'patch'
);
assert.equal(
  selectPatch(bundle, { baselineSha256: hashes.baseline, maxPatchBytes: 0 })
    .strategy,
  'full'
);
for (const baselineSha256 of [hashes.baseline, 'f'.repeat(64)]) {
  for (const maxPatchBytes of [
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    throwsCode(
      () => selectPatch(bundle, { baselineSha256, maxPatchBytes }),
      'EINVAL'
    );
  }
  for (const maxPatchRatio of [-1, 1.01, NaN, Infinity]) {
    throwsCode(
      () => selectPatch(bundle, { baselineSha256, maxPatchRatio }),
      'EINVAL'
    );
  }
}
throwsCode(() => selectPatch(bundle, { baselineSha256: 'wrong' }), 'EINVAL');

const cyclicArray = [];
cyclicArray.push(cyclicArray);
const cyclicObject = {};
cyclicObject.self = cyclicObject;
for (const invalid of [
  cyclicArray,
  cyclicObject,
  { a: Infinity },
  [undefined],
]) {
  throwsCode(() => canonicalJson(invalid), 'EINVALID_MANIFEST');
}
const shared = { b: 2 };
assert.equal(canonicalJson([shared, shared]), '[{"b":2},{"b":2}]');
assert.equal(
  canonicalJson(JSON.parse('{"__proto__":{"x":1},"a":2}')),
  '{"__proto__":{"x":1},"a":2}'
);
assert.equal(
  signingPayload({
    ...manifest,
    signature: { ...manifest.signature, keyId: 'different-key' },
  }),
  signingPayload(manifest)
);

const validHeader = new Uint8Array(24);
validHeader.set(new TextEncoder().encode('ENDSLEY/BSDIFF43'));
validHeader[16] = 5;
assert.deepEqual(inspectPatchHeader(validHeader, 100), {
  declaredTargetBytes: '5',
  format: 'ENDSLEY/BSDIFF43',
  headerBytes: 24,
  patchBytes: 100,
  payloadBytes: 76,
  valid: true,
});
assert.equal(
  inspectPatchHeader(validHeader).valid,
  true,
  'a header alone does not validate compressed payload'
);
for (let length = 0; length < 24; length += 1) {
  assert.equal(inspectPatchHeader(validHeader.slice(0, length)).valid, false);
}
assert.equal(
  inspectPatchHeader(new TextEncoder().encode('BSDIFF40')).issue,
  'LEGACY_FORMAT'
);
assert.equal(inspectPatchHeader(new Uint8Array(24)).issue, 'INVALID_MAGIC');
const negativeHeader = validHeader.slice();
negativeHeader[23] = 0x80;
assert.equal(inspectPatchHeader(negativeHeader).issue, 'INVALID_TARGET_SIZE');
const largeHeader = validHeader.slice();
largeHeader.fill(0xff, 16);
largeHeader[23] = 0x7f;
assert.equal(
  inspectPatchHeader(largeHeader).declaredTargetBytes,
  '9223372036854775807'
);
for (const input of [null, undefined, [], new ArrayBuffer(24)]) {
  throwsCode(() => inspectPatchHeader(input), 'EINVAL');
}
for (const length of [
  -1,
  23,
  24.5,
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  throwsCode(() => inspectPatchHeader(validHeader, length), 'EINVAL');
}
for (const [code, category] of Object.entries({
  EABORTED: 'ABORTED',
  ERESOURCE: 'RESOURCE',
  EINVAL: 'INVALID_ARGUMENT',
  EPATCH: 'INVALID_PATCH',
  ELEGACYFORMAT: 'INVALID_PATCH',
  ETARGETMISMATCH: 'VERIFICATION',
  EDESTEXISTS: 'DESTINATION',
  EUNSUPPORTED: 'UNSUPPORTED',
  EWEBASSEMBLY: 'RUNTIME',
})) {
  assert.equal(classifyPatchError({ code }).category, category);
}
assert.equal(classifyPatchError(null).code, 'EUNSPECIFIED');

console.log(
  'Toolkit manifest/bundle, selection, canonical payload, error and header boundary tests passed'
);
