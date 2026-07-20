/* eslint-env browser */

import { diffBytes, patchBytes } from '../web/index.mjs';

const PATCH_MAGIC = 'ENDSLEY/BSDIFF43';
const PATCH_HEADER_BYTES = 24;
const INSPECTOR_MAX_BYTES = 256 * 1024 * 1024;
const localized = document.documentElement.lang === 'zh-CN';

const ui = localized
  ? {
      aborted: '操作已取消',
      applying: '正在应用补丁…',
      applyName: '应用与验证',
      byteMismatch: '还原结果与预期文件不一致',
      bytesMatch: '逐字节一致',
      cancelled: '已取消',
      copied: '已复制',
      copyFailed: '请手动选择并复制',
      createName: '创建补丁',
      diffing: '正在生成并验证补丁…',
      failed: '失败',
      generatedPatch: '补丁已生成并完成逐字节验证',
      hashMismatch: '还原结果与可信 SHA-256 不一致',
      inspecting: '正在检查补丁…',
      inspectorLimit: 'Patch Inspector 目前最多读取 256 MiB 的补丁',
      inspectName: 'Patch Inspector',
      invalidHash: '预期 SHA-256 必须是 64 个十六进制字符',
      invalidPatch: '补丁头无效',
      legacyPatch: '检测到 BSDIFF40；它与 ENDSLEY/BSDIFF43 不兼容',
      missingApplyFiles: '请选择旧文件和补丁文件',
      missingCreateFiles: '请选择旧文件和新文件',
      missingInspectFile: '请选择要检查的补丁文件',
      noFile: '尚未选择文件',
      noReport: '操作完成后将在这里生成报告。',
      notVerified: '未提供预期文件或可信哈希；结果尚未完成完整性验证',
      ready: '就绪',
      restored: '补丁已应用，但未提供可信预期值',
      restoredVerified: '补丁已应用，目标完整性验证通过',
      runtimeReady: 'Web API 已就绪',
      structuralPass: '补丁头结构检查通过',
      truncatedPatch: '补丁不足 24 字节，头部已截断',
      unknownError: '工具操作失败',
      verificationFailed: '验证失败',
      verified: '通过',
      verifying: '正在计算 SHA-256 并验证字节…',
    }
  : {
      aborted: 'The operation was cancelled',
      applying: 'Applying patch…',
      applyName: 'Apply & Verify',
      byteMismatch: 'Restored bytes do not match the expected file',
      bytesMatch: 'Byte-for-byte match',
      cancelled: 'Cancelled',
      copied: 'Copied',
      copyFailed: 'Select and copy manually',
      createName: 'Create Patch',
      diffing: 'Generating and verifying the patch…',
      failed: 'Failed',
      generatedPatch: 'Patch generated and verified byte-for-byte',
      hashMismatch: 'Restored bytes do not match the trusted SHA-256',
      inspecting: 'Inspecting patch…',
      inspectorLimit: 'Patch Inspector currently reads patches up to 256 MiB',
      inspectName: 'Patch Inspector',
      invalidHash: 'Expected SHA-256 must contain 64 hexadecimal characters',
      invalidPatch: 'The patch header is invalid',
      legacyPatch:
        'BSDIFF40 detected; it is incompatible with ENDSLEY/BSDIFF43',
      missingApplyFiles: 'Choose an old file and a patch file',
      missingCreateFiles: 'Choose an old file and a new file',
      missingInspectFile: 'Choose a patch file to inspect',
      noFile: 'No file selected',
      noReport: 'A report will appear here after the operation.',
      notVerified:
        'No expected file or trusted digest was supplied; integrity is unverified',
      ready: 'Ready',
      restored: 'Patch applied without a trusted expected value',
      restoredVerified: 'Patch applied and target integrity verified',
      runtimeReady: 'Web API ready',
      structuralPass: 'Patch header structure passed',
      truncatedPatch: 'The patch is shorter than its 24-byte header',
      unknownError: 'The tool operation failed',
      verificationFailed: 'Verification failed',
      verified: 'PASS',
      verifying: 'Computing SHA-256 and verifying bytes…',
    };

function element(selector) {
  const match = document.querySelector(selector);
  if (!match) {
    throw new Error(`Missing tools page element: ${selector}`);
  }
  return match;
}

const runtimeState = element('#tool-runtime-state');
const toolTabs = [...document.querySelectorAll('[data-tool-tab]')];
const toolPanels = [...document.querySelectorAll('[data-tool-panel]')];
const platformButtons = [...document.querySelectorAll('[data-code-platform]')];
const codeOperationName = element('#code-operation-name');
const codeFilename = element('#tool-code-filename');
const toolCode = element('#tool-code');
const copyToolCodeButton = element('#copy-tool-code');
const fileSelections = new Map();

let activeTool = 'create';
let activeCodePlatform = 'web';
let activeOperation;
let currentCreatePatch;
let currentCreatePatchName = 'generated.patch';
let currentCreateReport = '';
let currentRestoredBytes;
let currentRestoredName = 'restored.bin';
let currentApplyReport = '';
let currentInspectReport = '';

const codeExamples = {
  create: {
    web: {
      filename: 'browser.ts',
      code: `import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

const controller = new AbortController();
const options = {
  signal: controller.signal,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
};

const patch = await diffBytes(oldFile, newFile, options);
const restored = await patchBytes(oldFile, patch, options);

// Compare restored with newFile and verify a trusted target digest.
download(new Blob([patch]), 'release.patch');`,
    },
    native: {
      filename: 'native.ts',
      code: `import { startDiff } from 'react-native-bs-diff-patch';

const job = startDiff(oldPath, newPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

const off = job.onProgress(({ phase, progress }) => {
  renderProgress(phase, progress);
});

cancelButton.onPress = () => job.cancel();
await job.result.finally(off);`,
    },
  },
  apply: {
    web: {
      filename: 'browser.ts',
      code: `import { patchBytes } from 'react-native-bs-diff-patch';

const restored = await patchBytes(oldFile, patchFile, {
  signal: controller.signal,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

const digest = await crypto.subtle.digest('SHA-256', restored);
assertDigest(toHex(digest), trustedTargetSha256);
download(new Blob([restored]), targetName);`,
    },
    native: {
      filename: 'native.ts',
      code: `import { startPatch } from 'react-native-bs-diff-patch';

const job = startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

cancelButton.onPress = () => job.cancel();
await job.result;

// Verify outputPath against a target digest from a trusted manifest.
await verifySha256(outputPath, trustedTargetSha256);`,
    },
  },
  inspect: {
    web: {
      filename: 'browser.ts',
      code: `import { patchBytes } from 'react-native-bs-diff-patch';

// The package validates the ENDSLEY/BSDIFF43 header before applying.
const restored = await patchBytes(oldFile, patchFile, {
  maxOutputBytes: expectedTargetSize,
});

// Header inspection is diagnostic only. A successful apply plus a
// trusted target digest is the complete integrity check.
await verifySha256(restored, trustedTargetSha256);`,
    },
    native: {
      filename: 'native.ts',
      code: `import { patch } from 'react-native-bs-diff-patch';

// Native patch rejects malformed input with EPATCH.
await patch(oldPath, outputPath, patchPath);

// Authenticate the restored result with application-owned metadata.
await verifySha256(outputPath, trustedTargetSha256);`,
    },
  },
};

const operationLabels = {
  create: ui.createName,
  apply: ui.applyName,
  inspect: ui.inspectName,
};

function selectedFile(inputId) {
  const input = element(`#${inputId}`);
  return fileSelections.get(inputId) || input.files?.[0];
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let amount = value;
  let unitIndex = -1;
  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${
    units[unitIndex]
  }`;
}

function formatBigIntBytes(value) {
  if (value <= window.BigInt(Number.MAX_SAFE_INTEGER)) {
    return formatBytes(Number(value));
  }
  return `${value.toLocaleString('en-US')} B`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
}

function selectedLimit(selector) {
  const value = element(selector).value;
  return value ? Number(value) : undefined;
}

function patchError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorDetails(error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'EUNKNOWN';
  const message = error instanceof Error ? error.message : ui.unknownError;
  return { code, message };
}

function updateFileSummary(inputId) {
  const file = selectedFile(inputId);
  const output = element(`[data-file-summary="${inputId}"]`);
  const zone = element(`[data-file-drop][for="${inputId}"]`);
  output.textContent = file
    ? `${file.name} · ${formatBytes(file.size)}`
    : ui.noFile;
  zone.classList.toggle('has-file', Boolean(file));
}

for (const zone of document.querySelectorAll('[data-file-drop]')) {
  const inputId = zone.getAttribute('for');
  const input = inputId ? element(`#${inputId}`) : undefined;

  input?.addEventListener('change', () => {
    if (input.files?.[0]) {
      fileSelections.set(input.id, input.files[0]);
    } else {
      fileSelections.delete(input.id);
    }
    updateFileSummary(input.id);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
    });
  }
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file && input) {
      fileSelections.set(input.id, file);
      updateFileSummary(input.id);
    }
  });
}

function clearFiles(inputIds) {
  for (const inputId of inputIds) {
    const input = element(`#${inputId}`);
    input.value = '';
    fileSelections.delete(inputId);
    updateFileSummary(inputId);
  }
}

function setStatus(name, state, message) {
  const status = element(`#${name}-status`);
  status.dataset.state = state;
  status.textContent = message;
}

function beginOperation(name, controller) {
  if (activeOperation) {
    throw patchError('EBUSY', ui.unknownError);
  }
  activeOperation = { controller, name };
  for (const button of document.querySelectorAll('.tool-run')) {
    button.disabled = true;
  }
  for (const button of document.querySelectorAll('[id$="-reset"]')) {
    button.disabled = true;
  }
  const cancelButton = document.querySelector(`#${name}-cancel`);
  if (cancelButton) cancelButton.disabled = !controller;
  runtimeState.dataset.state = 'working';
  runtimeState.textContent = messageForRuntime(name);
}

function messageForRuntime(name) {
  if (name === 'create') return ui.diffing;
  if (name === 'apply') return ui.applying;
  return ui.inspecting;
}

function finishOperation(name) {
  activeOperation = undefined;
  for (const button of document.querySelectorAll('.tool-run')) {
    button.disabled = false;
  }
  for (const button of document.querySelectorAll('[id$="-reset"]')) {
    button.disabled = false;
  }
  const cancelButton = document.querySelector(`#${name}-cancel`);
  if (cancelButton) cancelButton.disabled = true;
  runtimeState.dataset.state = 'ready';
  runtimeState.textContent = ui.runtimeReady;
}

function cancelOperation(name) {
  if (activeOperation?.name !== name || !activeOperation.controller) return;
  activeOperation.controller.abort();
  const cancelButton = element(`#${name}-cancel`);
  cancelButton.disabled = true;
  setStatus(name, 'running', ui.aborted);
}

async function inputBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(await input.arrayBuffer());
}

async function sha256(input) {
  const bytes = await inputBytes(input);
  const copied = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  const digest = await crypto.subtle.digest('SHA-256', copied);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function fileMatchesBytes(file, bytes) {
  if (file.size !== bytes.byteLength) return false;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (fileBytes[index] !== bytes[index]) return false;
  }
  return true;
}

function normalizeExpectedHash(value) {
  if (!value.trim()) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^sha-?256:/, '')
    .replaceAll(/\s/g, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw patchError('EINVAL', ui.invalidHash);
  }
  return normalized;
}

function decodePatchHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const observedMagic = String.fromCharCode(
    ...bytes.slice(0, Math.min(16, bytes.byteLength))
  ).replaceAll(/[^\x20-\x7e]/g, '.');
  const legacyMagic = String.fromCharCode(
    ...bytes.slice(0, Math.min(8, bytes.byteLength))
  );

  if (bytes.byteLength < PATCH_HEADER_BYTES) {
    return {
      declaredTargetBytes: undefined,
      format: observedMagic || '—',
      reason: legacyMagic === 'BSDIFF40' ? ui.legacyPatch : ui.truncatedPatch,
      valid: false,
    };
  }

  if (observedMagic !== PATCH_MAGIC) {
    return {
      declaredTargetBytes: undefined,
      format: observedMagic,
      reason: legacyMagic === 'BSDIFF40' ? ui.legacyPatch : ui.invalidPatch,
      valid: false,
    };
  }

  if (bytes[23] >= 0x80) {
    return {
      declaredTargetBytes: undefined,
      format: PATCH_MAGIC,
      reason: ui.invalidPatch,
      valid: false,
    };
  }

  let declaredTargetBytes = 0n;
  for (let index = 23; index >= 16; index -= 1) {
    declaredTargetBytes =
      declaredTargetBytes * 256n + window.BigInt(bytes[index]);
  }
  return {
    declaredTargetBytes,
    format: PATCH_MAGIC,
    reason: undefined,
    valid: true,
  };
}

function report(lines) {
  return lines.map(([label, value]) => `${label}: ${value ?? '—'}`).join('\n');
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/octet-stream' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function restoredFilename(oldName, expectedFile) {
  if (expectedFile) return expectedFile.name;
  const extensionIndex = oldName.lastIndexOf('.');
  return extensionIndex > 0
    ? `${oldName.slice(0, extensionIndex)}.restored${oldName.slice(
        extensionIndex
      )}`
    : `${oldName}.restored`;
}

async function flashCopied(button, action) {
  try {
    await action();
    const previous = button.innerHTML;
    button.textContent = ui.copied;
    setTimeout(() => {
      button.innerHTML = previous;
    }, 1200);
  } catch {
    button.textContent = ui.copyFailed;
  }
}

async function generatePatch() {
  const oldFile = selectedFile('create-old-file');
  const newFile = selectedFile('create-new-file');
  if (!oldFile || !newFile) {
    setStatus('create', 'error', ui.missingCreateFiles);
    return;
  }

  const controller = new AbortController();
  beginOperation('create', controller);
  currentCreatePatch = undefined;
  currentCreateReport = '';
  element('#create-download').disabled = true;
  element('#create-copy-report').disabled = true;
  element('#create-report').textContent = ui.noReport;
  element('#create-patch-size').textContent = '—';
  element('#create-saving').textContent = '—';
  element('#create-runtime').textContent = '—';
  element('#create-verification').textContent = '—';
  setStatus('create', 'running', ui.diffing);

  const options = {
    signal: controller.signal,
    maxInputBytes: selectedLimit('#create-max-input'),
    maxOutputBytes: selectedLimit('#create-max-output'),
  };
  const startedAt = performance.now();

  try {
    const patch = await diffBytes(oldFile, newFile, options);
    const restored = await patchBytes(oldFile, patch, options);
    setStatus('create', 'running', ui.verifying);

    if (!(await fileMatchesBytes(newFile, restored))) {
      throw patchError('EVERIFY', ui.byteMismatch);
    }

    const oldHash = await sha256(oldFile);
    const targetHash = await sha256(newFile);
    const patchHash = await sha256(patch);
    const header = decodePatchHeader(patch);
    const elapsed = performance.now() - startedAt;
    const savings =
      newFile.size === 0 ? 0 : (1 - patch.byteLength / newFile.size) * 100;

    currentCreatePatch = patch;
    currentCreatePatchName = `${newFile.name}.patch`;
    currentCreateReport = report([
      ['react-native-bs-diff-patch compatibility report', 'CREATE'],
      ['Status', 'PASS'],
      ['Patch format', header.format],
      ['Generated on', 'Web'],
      ['Verified on', 'Web'],
      ['Old file', oldFile.name],
      ['Old bytes', oldFile.size],
      ['Old SHA-256', oldHash],
      ['Target file', newFile.name],
      ['Target bytes', newFile.size],
      ['Target SHA-256', targetHash],
      ['Patch bytes', patch.byteLength],
      ['Patch SHA-256', patchHash],
      ['Byte-for-byte match', 'PASS'],
    ]);

    element('#create-patch-size').textContent = formatBytes(patch.byteLength);
    element('#create-saving').textContent = formatPercent(savings);
    element('#create-saving').classList.toggle('negative', savings < 0);
    element('#create-runtime').textContent = `${elapsed.toFixed(2)} ms`;
    element('#create-verification').textContent = ui.verified;
    element('#create-verification').dataset.state = 'success';
    element('#create-report').textContent = currentCreateReport;
    element('#create-download').disabled = false;
    element('#create-copy-report').disabled = false;
    setStatus('create', 'success', ui.generatedPatch);
  } catch (error) {
    const { code, message } = errorDetails(error);
    element('#create-verification').textContent = code;
    element('#create-verification').dataset.state = 'error';
    currentCreateReport = report([
      ['react-native-bs-diff-patch compatibility report', 'CREATE'],
      ['Status', 'FAIL'],
      ['Error code', code],
      ['Error', message],
    ]);
    element('#create-report').textContent = currentCreateReport;
    element('#create-copy-report').disabled = false;
    setStatus(
      'create',
      'error',
      code === 'EABORTED' ? ui.cancelled : `[${code}] ${message}`
    );
  } finally {
    finishOperation('create');
  }
}

async function applyPatch() {
  const oldFile = selectedFile('apply-old-file');
  const patchFile = selectedFile('apply-patch-file');
  const expectedFile = selectedFile('apply-expected-file');
  if (!oldFile || !patchFile) {
    setStatus('apply', 'error', ui.missingApplyFiles);
    return;
  }

  let expectedHash;
  try {
    expectedHash = normalizeExpectedHash(
      element('#apply-expected-sha256').value
    );
  } catch (error) {
    const { message } = errorDetails(error);
    setStatus('apply', 'error', message);
    return;
  }

  const maximumInput = selectedLimit('#apply-max-input');
  if (
    expectedFile &&
    maximumInput !== undefined &&
    expectedFile.size > maximumInput
  ) {
    setStatus(
      'apply',
      'error',
      `[ERESOURCE] expected target exceeds ${formatBytes(maximumInput)}`
    );
    return;
  }

  const controller = new AbortController();
  beginOperation('apply', controller);
  currentRestoredBytes = undefined;
  currentApplyReport = '';
  element('#apply-download').disabled = true;
  element('#apply-copy-report').disabled = true;
  element('#apply-report').textContent = ui.noReport;
  element('#apply-target-size').textContent = '—';
  element('#apply-patch-size').textContent = formatBytes(patchFile.size);
  element('#apply-runtime').textContent = '—';
  element('#apply-verification').textContent = '—';
  setStatus('apply', 'running', ui.applying);

  const options = {
    signal: controller.signal,
    maxInputBytes: maximumInput,
    maxOutputBytes: selectedLimit('#apply-max-output'),
  };
  const startedAt = performance.now();

  try {
    const restored = await patchBytes(oldFile, patchFile, options);
    setStatus('apply', 'running', ui.verifying);
    const restoredHash = await sha256(restored);
    const oldHash = await sha256(oldFile);
    const patchHash = await sha256(patchFile);
    const expectedFileHash = expectedFile
      ? await sha256(expectedFile)
      : undefined;
    const byteMatch = expectedFile
      ? await fileMatchesBytes(expectedFile, restored)
      : undefined;
    const trustedHashMatch = expectedHash
      ? restoredHash === expectedHash
      : undefined;
    const expectedFileHashMatch = expectedFileHash
      ? restoredHash === expectedFileHash
      : undefined;
    const hasExpectation = Boolean(expectedFile || expectedHash);
    const verified =
      hasExpectation &&
      byteMatch !== false &&
      trustedHashMatch !== false &&
      expectedFileHashMatch !== false;
    const elapsed = performance.now() - startedAt;

    currentRestoredBytes = restored;
    currentRestoredName = restoredFilename(oldFile.name, expectedFile);
    currentApplyReport = report([
      ['react-native-bs-diff-patch compatibility report', 'APPLY'],
      ['Status', verified ? 'PASS' : hasExpectation ? 'FAIL' : 'UNVERIFIED'],
      ['Patch format', PATCH_MAGIC],
      ['Generated on', element('#apply-origin').value],
      ['Verified on', 'Web'],
      ['Old file', oldFile.name],
      ['Old bytes', oldFile.size],
      ['Old SHA-256', oldHash],
      ['Patch file', patchFile.name],
      ['Patch bytes', patchFile.size],
      ['Patch SHA-256', patchHash],
      ['Restored bytes', restored.byteLength],
      ['Restored SHA-256', restoredHash],
      ['Expected SHA-256', expectedHash || expectedFileHash],
      [
        'Byte-for-byte match',
        byteMatch === undefined ? 'NOT PROVIDED' : byteMatch ? 'PASS' : 'FAIL',
      ],
      [
        'Trusted digest match',
        trustedHashMatch === undefined
          ? 'NOT PROVIDED'
          : trustedHashMatch
          ? 'PASS'
          : 'FAIL',
      ],
    ]);

    element('#apply-target-size').textContent = formatBytes(
      restored.byteLength
    );
    element('#apply-runtime').textContent = `${elapsed.toFixed(2)} ms`;
    element('#apply-report').textContent = currentApplyReport;
    element('#apply-download').disabled = false;
    element('#apply-copy-report').disabled = false;

    if (verified) {
      element('#apply-verification').textContent = ui.verified;
      element('#apply-verification').dataset.state = 'success';
      setStatus('apply', 'success', ui.restoredVerified);
    } else if (hasExpectation) {
      element('#apply-verification').textContent = ui.failed;
      element('#apply-verification').dataset.state = 'error';
      setStatus(
        'apply',
        'error',
        byteMatch === false ? ui.byteMismatch : ui.hashMismatch
      );
    } else {
      element('#apply-verification').textContent = 'UNVERIFIED';
      element('#apply-verification').dataset.state = 'warning';
      setStatus('apply', 'warning', ui.restored);
    }
  } catch (error) {
    const { code, message } = errorDetails(error);
    element('#apply-verification').textContent = code;
    element('#apply-verification').dataset.state = 'error';
    currentApplyReport = report([
      ['react-native-bs-diff-patch compatibility report', 'APPLY'],
      ['Status', 'FAIL'],
      ['Error code', code],
      ['Error', message],
    ]);
    element('#apply-report').textContent = currentApplyReport;
    element('#apply-copy-report').disabled = false;
    setStatus(
      'apply',
      'error',
      code === 'EABORTED' ? ui.cancelled : `[${code}] ${message}`
    );
  } finally {
    finishOperation('apply');
  }
}

async function inspectPatch() {
  const patchFile = selectedFile('inspect-patch-file');
  if (!patchFile) {
    setStatus('inspect', 'error', ui.missingInspectFile);
    return;
  }
  if (patchFile.size > INSPECTOR_MAX_BYTES) {
    setStatus('inspect', 'error', `[ERESOURCE] ${ui.inspectorLimit}`);
    return;
  }

  beginOperation('inspect');
  currentInspectReport = '';
  element('#inspect-copy-report').disabled = true;
  element('#inspect-report').textContent = ui.noReport;
  element('#inspect-format').textContent = '—';
  element('#inspect-target-size').textContent = '—';
  element('#inspect-patch-size').textContent = formatBytes(patchFile.size);
  element('#inspect-ratio').textContent = '—';
  setStatus('inspect', 'running', ui.inspecting);

  try {
    const patchBytesValue = await inputBytes(patchFile);
    const header = decodePatchHeader(patchBytesValue);
    const patchHash = await sha256(patchBytesValue);
    const payloadBytes = Math.max(0, patchFile.size - PATCH_HEADER_BYTES);
    const ratio =
      header.declaredTargetBytes !== undefined &&
      header.declaredTargetBytes > 0n &&
      header.declaredTargetBytes <= window.BigInt(Number.MAX_SAFE_INTEGER)
        ? (patchFile.size / Number(header.declaredTargetBytes)) * 100
        : undefined;

    currentInspectReport = report([
      ['react-native-bs-diff-patch structural report', 'INSPECT'],
      ['Status', header.valid ? 'PASS' : 'FAIL'],
      ['Patch file', patchFile.name],
      ['Patch bytes', patchFile.size],
      ['Header bytes', Math.min(patchFile.size, PATCH_HEADER_BYTES)],
      ['Compressed payload bytes', payloadBytes],
      ['Observed format', header.format],
      ['Declared target bytes', header.declaredTargetBytes?.toString()],
      ['Patch SHA-256', patchHash],
      ['Structural warning', header.reason],
      ['Full integrity', 'REQUIRES APPLY + TRUSTED TARGET DIGEST'],
    ]);

    element('#inspect-format').textContent = header.valid
      ? PATCH_MAGIC
      : 'INVALID';
    element('#inspect-format').dataset.state = header.valid
      ? 'success'
      : 'error';
    element('#inspect-target-size').textContent =
      header.declaredTargetBytes === undefined
        ? '—'
        : formatBigIntBytes(header.declaredTargetBytes);
    element('#inspect-ratio').textContent =
      ratio === undefined ? '—' : formatPercent(ratio);
    element('#inspect-report').textContent = currentInspectReport;
    element('#inspect-copy-report').disabled = false;
    setStatus(
      'inspect',
      header.valid ? 'success' : 'error',
      header.valid ? ui.structuralPass : header.reason || ui.invalidPatch
    );
  } catch (error) {
    const { code, message } = errorDetails(error);
    currentInspectReport = report([
      ['react-native-bs-diff-patch structural report', 'INSPECT'],
      ['Status', 'FAIL'],
      ['Error code', code],
      ['Error', message],
    ]);
    element('#inspect-report').textContent = currentInspectReport;
    element('#inspect-copy-report').disabled = false;
    setStatus('inspect', 'error', `[${code}] ${message}`);
  } finally {
    finishOperation('inspect');
  }
}

function resetCreate() {
  clearFiles(['create-old-file', 'create-new-file']);
  currentCreatePatch = undefined;
  currentCreateReport = '';
  element('#create-download').disabled = true;
  element('#create-copy-report').disabled = true;
  element('#create-patch-size').textContent = '—';
  element('#create-saving').textContent = '—';
  element('#create-saving').classList.remove('negative');
  element('#create-runtime').textContent = '—';
  element('#create-verification').textContent = '—';
  element('#create-verification').removeAttribute('data-state');
  element('#create-report').textContent = ui.noReport;
  setStatus('create', 'idle', ui.ready);
}

function resetApply() {
  clearFiles(['apply-old-file', 'apply-patch-file', 'apply-expected-file']);
  element('#apply-expected-sha256').value = '';
  element('#apply-origin').value = 'Unknown';
  currentRestoredBytes = undefined;
  currentApplyReport = '';
  element('#apply-download').disabled = true;
  element('#apply-copy-report').disabled = true;
  element('#apply-target-size').textContent = '—';
  element('#apply-patch-size').textContent = '—';
  element('#apply-runtime').textContent = '—';
  element('#apply-verification').textContent = '—';
  element('#apply-verification').removeAttribute('data-state');
  element('#apply-report').textContent = ui.noReport;
  setStatus('apply', 'idle', ui.ready);
}

function resetInspect() {
  clearFiles(['inspect-patch-file']);
  currentInspectReport = '';
  element('#inspect-copy-report').disabled = true;
  element('#inspect-format').textContent = '—';
  element('#inspect-format').removeAttribute('data-state');
  element('#inspect-target-size').textContent = '—';
  element('#inspect-patch-size').textContent = '—';
  element('#inspect-ratio').textContent = '—';
  element('#inspect-report').textContent = ui.noReport;
  setStatus('inspect', 'idle', ui.ready);
}

function updateCodeExample() {
  const example = codeExamples[activeTool][activeCodePlatform];
  codeOperationName.textContent = operationLabels[activeTool];
  codeFilename.textContent = example.filename;
  toolCode.textContent = example.code;
}

function selectTool(name, focus = false) {
  activeTool = name;
  for (const tab of toolTabs) {
    const selected = tab.dataset.toolTab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of toolPanels) {
    panel.hidden = panel.dataset.toolPanel !== name;
  }
  updateCodeExample();
}

for (const tab of toolTabs) {
  tab.addEventListener('click', () => selectTool(tab.dataset.toolTab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = toolTabs.indexOf(tab);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + direction + toolTabs.length) % toolTabs.length;
    selectTool(toolTabs[nextIndex].dataset.toolTab, true);
  });
}

for (const button of platformButtons) {
  button.addEventListener('click', () => {
    activeCodePlatform = button.dataset.codePlatform;
    for (const candidate of platformButtons) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }
    updateCodeExample();
  });
}

element('#create-run').addEventListener('click', generatePatch);
element('#create-cancel').addEventListener('click', () =>
  cancelOperation('create')
);
element('#create-reset').addEventListener('click', resetCreate);
element('#create-download').addEventListener('click', () => {
  if (currentCreatePatch) {
    downloadBytes(currentCreatePatch, currentCreatePatchName);
  }
});
element('#create-copy-report').addEventListener('click', (event) => {
  if (!currentCreateReport) return;
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(currentCreateReport)
  );
});

element('#apply-run').addEventListener('click', applyPatch);
element('#apply-cancel').addEventListener('click', () =>
  cancelOperation('apply')
);
element('#apply-reset').addEventListener('click', resetApply);
element('#apply-download').addEventListener('click', () => {
  if (currentRestoredBytes) {
    downloadBytes(currentRestoredBytes, currentRestoredName);
  }
});
element('#apply-copy-report').addEventListener('click', (event) => {
  if (!currentApplyReport) return;
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(currentApplyReport)
  );
});

element('#inspect-run').addEventListener('click', inspectPatch);
element('#inspect-reset').addEventListener('click', resetInspect);
element('#inspect-copy-report').addEventListener('click', (event) => {
  if (!currentInspectReport) return;
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(currentInspectReport)
  );
});

copyToolCodeButton.addEventListener('click', (event) => {
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(toolCode.textContent || '')
  );
});

for (const inputId of [
  'create-old-file',
  'create-new-file',
  'apply-old-file',
  'apply-patch-file',
  'apply-expected-file',
  'inspect-patch-file',
]) {
  updateFileSummary(inputId);
}

updateCodeExample();
runtimeState.dataset.state = 'ready';
runtimeState.textContent = ui.runtimeReady;
