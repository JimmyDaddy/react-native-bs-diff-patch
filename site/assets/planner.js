/* eslint-env browser */

import { diffBytes } from '/web/index.mjs';
import {
  canonicalJson,
  createPatchBundle,
  PATCH_FORMAT,
} from '/toolkit/index.mjs';

const localized = document.documentElement.lang === 'zh-CN';
const elements = {
  baselineCount: document.querySelector('#planner-baseline-count'),
  baselines: document.querySelector('#planner-baseline-files'),
  cancel: document.querySelector('#planner-cancel'),
  copyReport: document.querySelector('#planner-copy-report'),
  downloadManifest: document.querySelector('#planner-download-manifest'),
  fallbackCount: document.querySelector('#planner-fallback-count'),
  matrix: document.querySelector('#planner-matrix'),
  patchCount: document.querySelector('#planner-patch-count'),
  ratio: document.querySelector('#planner-max-ratio'),
  releaseId: document.querySelector('#planner-release-id'),
  reset: document.querySelector('#planner-reset'),
  run: document.querySelector('#planner-run'),
  runtime: document.querySelector('#planner-runtime-state'),
  savings: document.querySelector('#planner-savings'),
  status: document.querySelector('#planner-status'),
  target: document.querySelector('#planner-target-file'),
};
const ui = localized
  ? {
      aborted: '发布计划已取消',
      copied: '已复制发布报告',
      fallback: '完整文件',
      invalidRatio: '最大补丁比例必须在 0 到 1 之间',
      noFiles: '请选择一个目标文件和至少一个基线文件',
      noSelection: '尚未选择文件',
      patch: '使用补丁',
      planning: (current, total, name) =>
        `正在处理 ${current}/${total}：${name}`,
      ready: 'Web API 已就绪',
      reportEmpty: '生成计划后将在这里显示补丁矩阵。',
      success: (patches, fallbacks) =>
        `计划完成：${patches} 条差量路径，${fallbacks} 条完整文件回退`,
    }
  : {
      aborted: 'Release planning was cancelled',
      copied: 'Release report copied',
      fallback: 'Full file',
      invalidRatio: 'Maximum patch ratio must be between 0 and 1',
      noFiles: 'Choose one target file and at least one baseline',
      noSelection: 'No file selected',
      patch: 'Use patch',
      planning: (current, total, name) =>
        `Planning ${current}/${total}: ${name}`,
      ready: 'Web API ready',
      reportEmpty: 'The patch matrix will appear after planning.',
      success: (patches, fallbacks) =>
        `Plan complete: ${patches} delta routes, ${fallbacks} full-file fallbacks`,
    };

let controller;
let currentBundle;
let currentPatches = new Map();
let currentReport = '';

function setStatus(state, message) {
  elements.status.dataset.state = state;
  elements.status.textContent = message;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function sha256(data) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function updateFileSummary(input) {
  const output = document.querySelector(`[data-file-summary="${input.id}"]`);
  if (!output) {
    return;
  }
  if (!input.files?.length) {
    output.textContent = ui.noSelection;
    return;
  }
  if (input.files.length === 1) {
    output.textContent = `${input.files[0].name} · ${formatBytes(
      input.files[0].size
    )}`;
    return;
  }
  const bytes = [...input.files].reduce((sum, file) => sum + file.size, 0);
  output.textContent = `${input.files.length} files · ${formatBytes(bytes)}`;
}

for (const input of [elements.target, elements.baselines]) {
  input.addEventListener('change', () => updateFileSummary(input));
  const drop = input.closest('[data-file-drop]');
  for (const eventName of ['dragenter', 'dragover']) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    drop.addEventListener(eventName, () => {
      drop.classList.remove('is-dragging');
    });
  }
}

function renderMatrix(decisions) {
  elements.matrix.replaceChildren();
  for (const decision of decisions) {
    const row = document.createElement('tr');
    const shortHash = `${decision.baseline.sha256.slice(0, 12)}…`;
    row.innerHTML = `
      <td><strong></strong><small></small></td>
      <td><code></code></td>
      <td></td>
      <td></td>
      <td><span class="planner-decision"></span></td>
      <td></td>`;
    row.cells[0].querySelector('strong').textContent = decision.baseline.name;
    row.cells[0].querySelector('small').textContent = formatBytes(
      decision.baseline.bytes
    );
    const digest = row.cells[1].querySelector('code');
    digest.title = decision.baseline.sha256;
    digest.textContent = shortHash;
    row.cells[2].textContent = formatBytes(decision.patchBytes);
    row.cells[3].textContent = `${(decision.ratio * 100).toFixed(1)}%`;
    const strategy = row.cells[4].querySelector('.planner-decision');
    strategy.dataset.strategy = decision.strategy;
    strategy.textContent =
      decision.strategy === 'patch' ? ui.patch : ui.fallback;
    if (decision.strategy === 'patch') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'table-download';
      button.textContent = '.patch ↓';
      button.addEventListener('click', () => {
        download(decision.patch.name, currentPatches.get(decision.patch.name));
      });
      row.lastElementChild.append(button);
    } else {
      row.lastElementChild.textContent = decision.targetName;
    }
    elements.matrix.append(row);
  }
}

function resetResults() {
  currentBundle = undefined;
  currentPatches = new Map();
  currentReport = '';
  elements.baselineCount.textContent = '0';
  elements.patchCount.textContent = '0';
  elements.fallbackCount.textContent = '0';
  elements.savings.textContent = '—';
  elements.downloadManifest.disabled = true;
  elements.copyReport.disabled = true;
  elements.matrix.innerHTML = `<tr><td colspan="6">${ui.reportEmpty}</td></tr>`;
}

async function planRelease() {
  const targetFile = elements.target.files?.[0];
  const baselines = [...(elements.baselines.files || [])].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  if (!targetFile || baselines.length === 0) {
    setStatus('error', ui.noFiles);
    return;
  }
  const maximumRatio = Number(elements.ratio.value);
  if (!Number.isFinite(maximumRatio) || maximumRatio < 0 || maximumRatio > 1) {
    setStatus('error', ui.invalidRatio);
    return;
  }

  resetResults();
  controller = new AbortController();
  elements.run.disabled = true;
  elements.cancel.disabled = false;
  try {
    const targetData = new Uint8Array(await targetFile.arrayBuffer());
    const target = {
      bytes: targetData.byteLength,
      name: targetFile.name,
      sha256: await sha256(targetData),
      url: targetFile.name,
    };
    const decisions = [];
    const candidates = [];
    let selectedBytes = 0;

    for (let index = 0; index < baselines.length; index += 1) {
      const baselineFile = baselines[index];
      setStatus(
        'running',
        ui.planning(index + 1, baselines.length, baselineFile.name)
      );
      const baselineData = new Uint8Array(await baselineFile.arrayBuffer());
      const baseline = {
        bytes: baselineData.byteLength,
        name: baselineFile.name,
        sha256: await sha256(baselineData),
      };
      const patchData = await diffBytes(baselineData, targetData, {
        signal: controller.signal,
      });
      const patchName = `${String(index + 1).padStart(3, '0')}-${safeName(
        baselineFile.name
      )}.patch`;
      const patch = {
        bytes: patchData.byteLength,
        name: patchName,
        sha256: await sha256(patchData),
        url: patchName,
      };
      const ratio = patch.bytes / Math.max(1, target.bytes);
      const strategy = ratio <= maximumRatio ? 'patch' : 'full';
      if (strategy === 'patch') {
        candidates.push({
          baseline,
          declaredTargetBytes: String(target.bytes),
          format: PATCH_FORMAT,
          patch,
        });
        currentPatches.set(patchName, patchData);
        selectedBytes += patch.bytes;
      } else {
        selectedBytes += target.bytes;
      }
      decisions.push({
        baseline,
        patch,
        patchBytes: patch.bytes,
        ratio,
        strategy,
        targetName: target.name,
      });
    }

    currentBundle = createPatchBundle({
      full: target,
      patches: candidates,
      releaseId: elements.releaseId.value.trim() || undefined,
      target,
    });
    const patchCount = candidates.length;
    const fallbackCount = baselines.length - patchCount;
    const fullTransferBytes = target.bytes * baselines.length;
    const savings =
      fullTransferBytes === 0
        ? 0
        : Math.max(0, 1 - selectedBytes / fullTransferBytes);
    elements.baselineCount.textContent = String(baselines.length);
    elements.patchCount.textContent = String(patchCount);
    elements.fallbackCount.textContent = String(fallbackCount);
    elements.savings.textContent = `${(savings * 100).toFixed(1)}%`;
    renderMatrix(decisions);
    currentReport = [
      'Verified Delta Release Plan',
      `Target: ${target.name}`,
      `Target SHA-256: ${target.sha256}`,
      `Target bytes: ${target.bytes}`,
      `Patch routes: ${patchCount}`,
      `Full fallbacks: ${fallbackCount}`,
      `Estimated transfer saved: ${(savings * 100).toFixed(1)}%`,
      '',
      ...decisions.map(
        (decision) =>
          `${decision.baseline.name} -> ${decision.strategy.toUpperCase()} (${(
            decision.ratio * 100
          ).toFixed(1)}%, ${decision.baseline.sha256})`
      ),
    ].join('\n');
    elements.downloadManifest.disabled = false;
    elements.copyReport.disabled = false;
    setStatus('success', ui.success(patchCount, fallbackCount));
  } catch (error) {
    setStatus(
      'error',
      error && error.code === 'EABORTED'
        ? ui.aborted
        : `[${error.code || 'EPLANNER'}] ${error.message || error}`
    );
  } finally {
    controller = undefined;
    elements.run.disabled = false;
    elements.cancel.disabled = true;
  }
}

elements.run.addEventListener('click', planRelease);
elements.cancel.addEventListener('click', () => controller?.abort());
elements.reset.addEventListener('click', () => {
  controller?.abort();
  elements.target.value = '';
  elements.baselines.value = '';
  elements.ratio.value = '0.85';
  elements.releaseId.value = '';
  updateFileSummary(elements.target);
  updateFileSummary(elements.baselines);
  resetResults();
  setStatus('idle', ui.ready);
});
elements.downloadManifest.addEventListener('click', () => {
  if (currentBundle) {
    download(
      'bundle-manifest.json',
      `${JSON.stringify(currentBundle, null, 2)}\n`,
      'application/json'
    );
    download(
      'bundle-manifest.canonical.json',
      canonicalJson(currentBundle),
      'application/json'
    );
  }
});
elements.copyReport.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentReport);
  setStatus('success', ui.copied);
});

resetResults();
elements.runtime.dataset.state = 'ready';
elements.runtime.textContent = ui.ready;
