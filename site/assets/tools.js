/* eslint-env browser */

import {
  diffBytes,
  inspectPatch as inspectPatchMetadata,
  patchBytes,
} from '../web/index.mjs';

const PATCH_MAGIC = 'ENDSLEY/BSDIFF43';
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
      invalidSavings: '请输入有效的目标大小、补丁大小和正整数下载次数',
      invalidPatch: '补丁头无效',
      legacyPatch: '检测到 BSDIFF40；它与 ENDSLEY/BSDIFF43 不兼容',
      missingApplyFiles: '请选择旧文件和补丁文件',
      missingCreateFiles: '请选择旧文件和新文件',
      missingInspectFile: '请选择要检查的补丁文件',
      missingManifestFiles: '请选择基线、目标和补丁文件',
      manifesting: '正在计算三个文件的 SHA-256…',
      manifestReady: '完整性清单已生成',
      manifestTargetMismatch: '补丁声明的目标大小与所选目标文件不一致',
      noFile: '尚未选择文件',
      noReport: '操作完成后将在这里生成报告。',
      notVerified: '未提供预期文件或可信哈希；结果尚未完成完整性验证',
      ready: '就绪',
      restored: '补丁已应用，但未提供可信预期值',
      restoredVerified: '补丁已应用，目标完整性验证通过',
      runtimeReady: 'Web API 已就绪',
      structuralPass: '补丁头结构检查通过',
      trafficIncreased: '补丁大于目标文件，传输量会增加',
      trafficSaved: '传输节省估算已更新',
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
      invalidSavings:
        'Enter valid target and patch sizes plus a positive integer download count',
      invalidPatch: 'The patch header is invalid',
      legacyPatch:
        'BSDIFF40 detected; it is incompatible with ENDSLEY/BSDIFF43',
      missingApplyFiles: 'Choose an old file and a patch file',
      missingCreateFiles: 'Choose an old file and a new file',
      missingInspectFile: 'Choose a patch file to inspect',
      missingManifestFiles: 'Choose a baseline, target, and patch file',
      manifesting: 'Computing SHA-256 for all three files…',
      manifestReady: 'Integrity manifest generated',
      manifestTargetMismatch:
        'The patch declared target size does not match the selected target file',
      noFile: 'No file selected',
      noReport: 'A report will appear here after the operation.',
      notVerified:
        'No expected file or trusted digest was supplied; integrity is unverified',
      ready: 'Ready',
      restored: 'Patch applied without a trusted expected value',
      restoredVerified: 'Patch applied and target integrity verified',
      runtimeReady: 'Web API ready',
      structuralPass: 'Patch header structure passed',
      trafficIncreased:
        'The patch is larger than the target and increases traffic',
      trafficSaved: 'Transfer savings estimate updated',
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
let currentManifestJson = '';

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
      code: `import { inspectPatch, verifyPatch } from 'react-native-bs-diff-patch';

const metadata = await inspectPatch(patchFile, {
  maxInputBytes: 64 * 1024 * 1024,
});

const result = await verifyPatch(oldFile, patchFile, expectedFile, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});
if (!result.verified) throw new Error('Target mismatch');`,
    },
    native: {
      filename: 'native.ts',
      code: `import { inspectPatch, verifyPatch } from 'react-native-bs-diff-patch';

const metadata = await inspectPatch(patchPath);
const result = await verifyPatch(oldPath, patchPath, expectedPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});
if (!result.verified) throw new Error('Target mismatch');`,
    },
  },
};

const operationLabels = {
  create: ui.createName,
  apply: ui.applyName,
  inspect: ui.inspectName,
};

const errorDiagnostics = localized
  ? {
      EINVAL: {
        platform: 'Android / iOS / Web',
        cause: '路径、二进制输入或字节上限无效。',
        action: '检查空路径、重复路径、输入类型，并确保限制是正安全整数。',
        example: `if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) {
  throw new Error('Invalid maxInputBytes');
}`,
      },
      ENOENT: {
        platform: 'Android / iOS',
        cause: '基线、目标或补丁路径不存在，或当前进程无法访问。',
        action: '在启动任务前解析 URI，并确认三个路径都指向可读的本地文件。',
        example: `await assertReadableFile(oldPath);
await assertReadableFile(patchPath);`,
      },
      EEXIST: {
        platform: 'Android / iOS',
        cause: '目标输出路径已经存在。库不会静默覆盖现有文件。',
        action: '使用新的临时输出路径；验证成功后再由应用执行原子替换。',
        example: `const outputPath = createUniqueTemporaryPath();
await patch(oldPath, outputPath, patchPath);`,
      },
      EBUSY: {
        platform: 'Android / iOS',
        cause: '任务 ID 或输出资源仍被另一个原生操作占用。',
        action: '等待当前 job.result 完成，或取消当前任务后再启动新任务。',
        example: `await activeJob.cancel();
await activeJob.result.catch(() => undefined);`,
      },
      EABORTED: {
        platform: 'Android / iOS / Web',
        cause: '原生 job 被取消，或 Web AbortSignal 在执行前或执行中触发。',
        action: '把它作为预期控制流处理，并丢弃未完成操作的界面状态。',
        example: `if (error.code === 'EABORTED') {
  return;
}`,
      },
      ECANCELLED: {
        platform: 'Android / iOS',
        cause: '原生 job 在排队或执行过程中收到协作式取消请求。',
        action: '把它作为预期控制流处理，并确认业务没有采用未完成的输出路径。',
        example: `if (error.code === 'ECANCELLED') {
  return;
}`,
      },
      ERESOURCE: {
        platform: 'Android / iOS / Web',
        cause: '输入、生成补丁或声明的还原输出超过配置的字节上限。',
        action:
          '核对可信清单中的大小；确认合理后再提高 maxInputBytes 或 maxOutputBytes。',
        example: `const options = {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
};`,
      },
      EINPUT_TOO_LARGE: {
        platform: 'Android / iOS',
        cause: '原生 job 的某个输入文件超过 maxInputBytes。',
        action: '核对清单中的文件大小；确认可信后提高上限，或拒绝本次更新。',
        example: `startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
});`,
      },
      EOUTPUT_TOO_LARGE: {
        platform: 'Android / iOS',
        cause: '原生 job 生成的补丁或还原目标超过 maxOutputBytes。',
        action: '检查补丁声明的目标大小；不要在未知来源补丁上盲目提高上限。',
        example: `startPatch(oldPath, outputPath, patchPath, {
  maxOutputBytes: 128 * 1024 * 1024,
});`,
      },
      EUNSUPPORTED: {
        platform: 'Android / iOS / Web',
        cause: '调用了当前平台不支持的 API，或 Web 环境没有 Worker。',
        action:
          '原生使用路径 API；浏览器客户端使用 diffBytes/patchBytes，避免在 SSR 中执行。',
        example: `const result = Platform.OS === 'web'
  ? await patchBytes(oldFile, patchFile)
  : await patch(oldPath, outputPath, patchPath);`,
      },
      EUNAVAILABLE: {
        platform: 'Android / iOS',
        cause:
          'React Native 原生模块的工作队列已经关闭，通常发生在模块失效之后。',
        action:
          '停止复用旧 job；等待新的 React Native runtime 创建模块后再执行。',
        example: `// Do not retain native jobs across React Native runtime reloads.
const job = startPatch(oldPath, outputPath, patchPath);`,
      },
      EDIFF: {
        platform: 'Android / iOS',
        cause: '原生差量核心拒绝输入，或无法完成补丁输出。',
        action: '确认输入可读、输出目录可写且空间充足，然后用相同文件复现。',
        example: `const job = startDiff(oldPath, newPath, patchPath);
await job.result;`,
      },
      EPATCH: {
        platform: 'Android / iOS',
        cause: '补丁损坏、格式不兼容、基线不匹配，或还原输出失败。',
        action:
          '先检查 ENDSLEY/BSDIFF43 头，再用可信基线和目标摘要完成端到端验证。',
        example: `await patch(oldPath, outputPath, patchPath);
await verifySha256(outputPath, trustedTargetSha256);`,
      },
      EWEBASSEMBLY: {
        platform: 'Web',
        cause: 'Worker/Wasm 加载失败，或 Wasm 核心拒绝了损坏的补丁。',
        action:
          '确认资源通过同源 HTTPS 提供，再在受支持浏览器中复现并检查补丁完整性。',
        example: `// Run in browser client code, not SSR.
const restored = await patchBytes(oldFile, patchFile);`,
      },
      EUNSPECIFIED: {
        platform: 'Android / iOS',
        cause: '原生层抛出了尚未分类的异常。',
        action:
          '保留平台、RN 版本、路径状态和完整错误信息，并提交可复现 Issue。',
        example: `captureDiagnostic({
  platform: Platform.OS,
  reactNativeVersion,
  error,
});`,
      },
    }
  : {
      EINVAL: {
        platform: 'Android / iOS / Web',
        cause: 'A path, binary input, or configured byte limit is invalid.',
        action:
          'Check empty or duplicate paths, input types, and positive safe-integer limits.',
        example: `if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) {
  throw new Error('Invalid maxInputBytes');
}`,
      },
      ENOENT: {
        platform: 'Android / iOS',
        cause:
          'A baseline, target, or patch path is missing or inaccessible to the process.',
        action:
          'Resolve content URIs and confirm every input points to a readable local file before starting.',
        example: `await assertReadableFile(oldPath);
await assertReadableFile(patchPath);`,
      },
      EEXIST: {
        platform: 'Android / iOS',
        cause:
          'The destination already exists. The library does not silently overwrite it.',
        action:
          'Write to a unique temporary path, verify it, then let the app perform an atomic replacement.',
        example: `const outputPath = createUniqueTemporaryPath();
await patch(oldPath, outputPath, patchPath);`,
      },
      EBUSY: {
        platform: 'Android / iOS',
        cause:
          'Another native operation still owns the job or output resource.',
        action:
          'Wait for the active job.result, or cancel and settle it before starting another job.',
        example: `await activeJob.cancel();
await activeJob.result.catch(() => undefined);`,
      },
      EABORTED: {
        platform: 'Android / iOS / Web',
        cause:
          'A native job was cancelled or the Web AbortSignal fired before or during work.',
        action:
          'Treat cancellation as expected control flow and discard incomplete operation state.',
        example: `if (error.code === 'EABORTED') {
  return;
}`,
      },
      ECANCELLED: {
        platform: 'Android / iOS',
        cause:
          'A native job received cooperative cancellation while queued or active.',
        action:
          'Treat it as expected control flow and ensure the app never adopts an incomplete output path.',
        example: `if (error.code === 'ECANCELLED') {
  return;
}`,
      },
      ERESOURCE: {
        platform: 'Android / iOS / Web',
        cause:
          'An input, generated patch, or declared restored output exceeded a configured byte limit.',
        action:
          'Compare the size with a trusted manifest, then raise maxInputBytes or maxOutputBytes only when justified.',
        example: `const options = {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
};`,
      },
      EINPUT_TOO_LARGE: {
        platform: 'Android / iOS',
        cause: 'A native job input exceeded maxInputBytes.',
        action:
          'Compare the file size with the manifest, then raise the limit only for a trusted update.',
        example: `startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
});`,
      },
      EOUTPUT_TOO_LARGE: {
        platform: 'Android / iOS',
        cause:
          'A native job generated a patch or restored target larger than maxOutputBytes.',
        action:
          'Inspect the declared target size and never raise the limit blindly for an untrusted patch.',
        example: `startPatch(oldPath, outputPath, patchPath, {
  maxOutputBytes: 128 * 1024 * 1024,
});`,
      },
      EUNSUPPORTED: {
        platform: 'Android / iOS / Web',
        cause:
          'The selected API is unavailable on this platform, or the Web environment has no Worker.',
        action:
          'Use path APIs on native and diffBytes/patchBytes in browser client code, never during SSR.',
        example: `const result = Platform.OS === 'web'
  ? await patchBytes(oldFile, patchFile)
  : await patch(oldPath, outputPath, patchPath);`,
      },
      EUNAVAILABLE: {
        platform: 'Android / iOS',
        cause:
          'The native module worker has shut down, usually after its React Native runtime was invalidated.',
        action:
          'Stop reusing retained jobs and wait for the new React Native runtime to create the module.',
        example: `// Do not retain native jobs across React Native runtime reloads.
const job = startPatch(oldPath, outputPath, patchPath);`,
      },
      EDIFF: {
        platform: 'Android / iOS',
        cause:
          'The native diff core rejected its inputs or could not complete the patch output.',
        action:
          'Confirm readable inputs, a writable destination, and free storage, then reproduce with the same files.',
        example: `const job = startDiff(oldPath, newPath, patchPath);
await job.result;`,
      },
      EPATCH: {
        platform: 'Android / iOS',
        cause:
          'The patch is corrupt or incompatible, the baseline is wrong, or restored output failed.',
        action:
          'Inspect the ENDSLEY/BSDIFF43 header, then verify with trusted baseline and target digests.',
        example: `await patch(oldPath, outputPath, patchPath);
await verifySha256(outputPath, trustedTargetSha256);`,
      },
      EWEBASSEMBLY: {
        platform: 'Web',
        cause:
          'The Worker/Wasm runtime failed to load, or the Wasm core rejected a corrupt patch.',
        action:
          'Serve package assets over same-origin HTTPS, reproduce in a supported browser, and check patch integrity.',
        example: `// Run in browser client code, not SSR.
const restored = await patchBytes(oldFile, patchFile);`,
      },
      EUNSPECIFIED: {
        platform: 'Android / iOS',
        cause:
          'The native layer raised an exception that is not classified yet.',
        action:
          'Capture platform, React Native version, path state, and the full error, then file a reproducible issue.',
        example: `captureDiagnostic({
  platform: Platform.OS,
  reactNativeVersion,
  error,
});`,
      },
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

function formatSignedBytes(value) {
  if (!Number.isFinite(value)) return '—';
  const prefix = value < 0 ? '−' : '';
  return `${prefix}${formatBytes(Math.abs(value))}`;
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
  if (name === 'manifest') return ui.manifesting;
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

function patchIssueMessage(issue) {
  if (issue === 'LEGACY_FORMAT') return ui.legacyPatch;
  if (issue === 'TRUNCATED_HEADER') return ui.truncatedPatch;
  return ui.invalidPatch;
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

function downloadText(value, filename, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([value], { type }));
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

async function generateManifest() {
  const oldFile = selectedFile('manifest-old-file');
  const newFile = selectedFile('manifest-new-file');
  const patchFile = selectedFile('manifest-patch-file');
  if (!oldFile || !newFile || !patchFile) {
    setStatus('manifest', 'error', ui.missingManifestFiles);
    return;
  }
  if (
    oldFile.size > INSPECTOR_MAX_BYTES ||
    newFile.size > INSPECTOR_MAX_BYTES ||
    patchFile.size > INSPECTOR_MAX_BYTES
  ) {
    setStatus('manifest', 'error', `[ERESOURCE] ${ui.inspectorLimit}`);
    return;
  }

  beginOperation('manifest');
  currentManifestJson = '';
  element('#manifest-copy').disabled = true;
  element('#manifest-download').disabled = true;
  element('#manifest-output').textContent = '—';
  setStatus('manifest', 'running', ui.manifesting);

  try {
    const patchData = await inputBytes(patchFile);
    const metadata = await inspectPatchMetadata(patchData, {
      maxInputBytes: INSPECTOR_MAX_BYTES,
    });
    if (!metadata.valid || metadata.declaredTargetBytes === null) {
      throw patchError('EPATCH', patchIssueMessage(metadata.issue));
    }
    if (
      window.BigInt(metadata.declaredTargetBytes) !==
      window.BigInt(newFile.size)
    ) {
      throw patchError('EVERIFY', ui.manifestTargetMismatch);
    }

    const [oldHash, newHash, patchHash] = await Promise.all([
      sha256(oldFile),
      sha256(newFile),
      sha256(patchData),
    ]);
    const savedBytes = newFile.size - patchFile.size;
    const savingRatio =
      newFile.size === 0 ? 0 : (savedBytes / newFile.size) * 100;
    currentManifestJson = `${JSON.stringify(
      {
        manifestVersion: 1,
        patchFormat: PATCH_MAGIC,
        baseline: {
          filename: oldFile.name,
          bytes: oldFile.size,
          sha256: oldHash,
        },
        target: {
          filename: newFile.name,
          bytes: newFile.size,
          sha256: newHash,
        },
        patch: {
          filename: patchFile.name,
          bytes: patchFile.size,
          sha256: patchHash,
          declaredTargetBytes: metadata.declaredTargetBytes,
        },
        transfer: {
          savedBytes,
          savingRatioPercent: Number(savingRatio.toFixed(4)),
        },
      },
      null,
      2
    )}\n`;
    element('#manifest-output').textContent = currentManifestJson;
    element('#manifest-copy').disabled = false;
    element('#manifest-download').disabled = false;
    setStatus('manifest', 'success', ui.manifestReady);
  } catch (error) {
    const { code, message } = errorDetails(error);
    currentManifestJson = '';
    element('#manifest-output').textContent = `[${code}] ${message}`;
    setStatus('manifest', 'error', `[${code}] ${message}`);
  } finally {
    finishOperation('manifest');
  }
}

function resetManifest() {
  clearFiles(['manifest-old-file', 'manifest-new-file', 'manifest-patch-file']);
  currentManifestJson = '';
  element('#manifest-copy').disabled = true;
  element('#manifest-download').disabled = true;
  element('#manifest-output').textContent = '—';
  setStatus('manifest', 'idle', ui.ready);
}

function calculateSavings() {
  const targetMiB = Number(element('#savings-target-mib').value);
  const patchMiB = Number(element('#savings-patch-mib').value);
  const downloads = Number(element('#savings-downloads').value);
  if (
    !Number.isFinite(targetMiB) ||
    targetMiB <= 0 ||
    !Number.isFinite(patchMiB) ||
    patchMiB < 0 ||
    !Number.isSafeInteger(downloads) ||
    downloads <= 0
  ) {
    for (const id of [
      '#savings-rate',
      '#savings-per-download',
      '#savings-total',
      '#savings-equivalent',
    ]) {
      element(id).textContent = '—';
      element(id).classList.remove('negative');
    }
    setStatus('savings', 'error', ui.invalidSavings);
    return;
  }

  const targetBytes = targetMiB * 1024 * 1024;
  const patchBytesValue = patchMiB * 1024 * 1024;
  const savedPerDownload = targetBytes - patchBytesValue;
  const savedTotal = savedPerDownload * downloads;
  const savingRate = (savedPerDownload / targetBytes) * 100;
  const equivalentDownloads = savedTotal / targetBytes;
  const increased = savedPerDownload < 0;

  element('#savings-rate').textContent = formatPercent(savingRate);
  element('#savings-per-download').textContent =
    formatSignedBytes(savedPerDownload);
  element('#savings-total').textContent = formatSignedBytes(savedTotal);
  element('#savings-equivalent').textContent =
    equivalentDownloads.toLocaleString(localized ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: 1,
    });
  for (const id of [
    '#savings-rate',
    '#savings-per-download',
    '#savings-total',
    '#savings-equivalent',
  ]) {
    element(id).classList.toggle('negative', increased);
  }
  setStatus(
    'savings',
    increased ? 'warning' : 'success',
    increased ? ui.trafficIncreased : ui.trafficSaved
  );
}

function diagnosisText() {
  const code = element('#diagnostic-code').value;
  const diagnosis = errorDiagnostics[code];
  return `${code}\n${localized ? '适用平台' : 'Platform'}: ${
    diagnosis.platform
  }\n${localized ? '常见原因' : 'Likely cause'}: ${diagnosis.cause}\n${
    localized ? '下一步动作' : 'Next action'
  }: ${diagnosis.action}\n\n${diagnosis.example}`;
}

function renderDiagnosis() {
  const diagnosis = errorDiagnostics[element('#diagnostic-code').value];
  element('#diagnostic-platform').textContent = diagnosis.platform;
  element('#diagnostic-cause').textContent = diagnosis.cause;
  element('#diagnostic-action').textContent = diagnosis.action;
  element('#diagnostic-example').textContent = diagnosis.example;
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
    const metadata = await inspectPatchMetadata(patch);
    const elapsed = performance.now() - startedAt;
    const savings =
      newFile.size === 0 ? 0 : (1 - patch.byteLength / newFile.size) * 100;

    currentCreatePatch = patch;
    currentCreatePatchName = `${newFile.name}.patch`;
    currentCreateReport = report([
      ['react-native-bs-diff-patch compatibility report', 'CREATE'],
      ['Status', 'PASS'],
      ['Patch format', metadata.format],
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

async function runPatchInspection() {
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
    const metadata = await inspectPatchMetadata(patchBytesValue, {
      maxInputBytes: INSPECTOR_MAX_BYTES,
    });
    const patchHash = await sha256(patchBytesValue);
    const declaredTargetBytes =
      metadata.declaredTargetBytes === null
        ? undefined
        : window.BigInt(metadata.declaredTargetBytes);
    const ratio =
      declaredTargetBytes !== undefined &&
      declaredTargetBytes > 0n &&
      declaredTargetBytes <= window.BigInt(Number.MAX_SAFE_INTEGER)
        ? (patchFile.size / Number(declaredTargetBytes)) * 100
        : undefined;

    currentInspectReport = report([
      ['react-native-bs-diff-patch structural report', 'INSPECT'],
      ['Status', metadata.valid ? 'PASS' : 'FAIL'],
      ['Patch file', patchFile.name],
      ['Patch bytes', patchFile.size],
      ['Header bytes', metadata.headerBytes],
      ['Compressed payload bytes', metadata.payloadBytes],
      ['Observed format', metadata.format],
      ['Declared target bytes', metadata.declaredTargetBytes],
      ['Patch SHA-256', patchHash],
      ['Structural warning', metadata.issue],
      ['Full integrity', 'REQUIRES APPLY + TRUSTED TARGET DIGEST'],
    ]);

    element('#inspect-format').textContent = metadata.valid
      ? PATCH_MAGIC
      : 'INVALID';
    element('#inspect-format').dataset.state = metadata.valid
      ? 'success'
      : 'error';
    element('#inspect-target-size').textContent =
      declaredTargetBytes === undefined
        ? '—'
        : formatBigIntBytes(declaredTargetBytes);
    element('#inspect-ratio').textContent =
      ratio === undefined ? '—' : formatPercent(ratio);
    element('#inspect-report').textContent = currentInspectReport;
    element('#inspect-copy-report').disabled = false;
    setStatus(
      'inspect',
      metadata.valid ? 'success' : 'error',
      metadata.valid ? ui.structuralPass : patchIssueMessage(metadata.issue)
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

element('#inspect-run').addEventListener('click', runPatchInspection);
element('#inspect-reset').addEventListener('click', resetInspect);
element('#inspect-copy-report').addEventListener('click', (event) => {
  if (!currentInspectReport) return;
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(currentInspectReport)
  );
});

element('#manifest-run').addEventListener('click', generateManifest);
element('#manifest-reset').addEventListener('click', resetManifest);
element('#manifest-copy').addEventListener('click', (event) => {
  if (!currentManifestJson) return;
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(currentManifestJson)
  );
});
element('#manifest-download').addEventListener('click', () => {
  if (currentManifestJson) {
    downloadText(
      currentManifestJson,
      'patch-manifest.json',
      'application/json'
    );
  }
});

for (const selector of [
  '#savings-target-mib',
  '#savings-patch-mib',
  '#savings-downloads',
]) {
  element(selector).addEventListener('input', calculateSavings);
}

element('#diagnostic-code').addEventListener('change', renderDiagnosis);
element('#diagnostic-copy').addEventListener('click', (event) => {
  flashCopied(event.currentTarget, () =>
    navigator.clipboard.writeText(diagnosisText())
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
  'manifest-old-file',
  'manifest-new-file',
  'manifest-patch-file',
]) {
  updateFileSummary(inputId);
}

updateCodeExample();
calculateSavings();
renderDiagnosis();
runtimeState.dataset.state = 'ready';
runtimeState.textContent = ui.runtimeReady;
