/* eslint-env browser */

import { diffBytes, patchBytes } from '../web/index.mjs';

const encoder = new TextEncoder();
const oldPayload = document.querySelector('#old-payload');
const newPayload = document.querySelector('#new-payload');
const oldSize = document.querySelector('#old-size');
const newSize = document.querySelector('#new-size');
const patchSize = document.querySelector('#patch-size');
const transferSaved = document.querySelector('#transfer-saved');
const runtimeMs = document.querySelector('#runtime-ms');
const runtimeState = document.querySelector('#runtime-state');
const status = document.querySelector('#playground-status');
const generateButton = document.querySelector('#generate-patch');
const downloadButton = document.querySelector('#download-patch');

let currentPatch;

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function updateInputSizes() {
  oldSize.value = formatBytes(encoder.encode(oldPayload.value).byteLength);
  newSize.value = formatBytes(encoder.encode(newPayload.value).byteLength);
}

function setStatus(state, message) {
  status.dataset.state = state;
  status.lastChild.textContent = message;
}

function bytesEqual(left, right) {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

async function generatePatch() {
  const oldData = encoder.encode(oldPayload.value);
  const newData = encoder.encode(newPayload.value);

  generateButton.disabled = true;
  downloadButton.disabled = true;
  generateButton.classList.add('is-running');
  setStatus('running', 'Generating patch in the Web Worker…');

  const startedAt = performance.now();

  try {
    const patchData = await diffBytes(oldData, newData);
    const restoredData = await patchBytes(oldData, patchData);

    if (!bytesEqual(restoredData, newData)) {
      throw new Error('The reconstructed payload did not match the target');
    }

    const elapsed = performance.now() - startedAt;
    const saved = newData.byteLength
      ? (1 - patchData.byteLength / newData.byteLength) * 100
      : 0;

    currentPatch = patchData;
    patchSize.textContent = formatBytes(patchData.byteLength);
    transferSaved.textContent =
      saved >= 0
        ? `${saved.toFixed(1)}%`
        : `${Math.abs(saved).toFixed(1)}% overhead`;
    transferSaved.classList.toggle('negative', saved < 0);
    runtimeMs.textContent = `${elapsed.toFixed(2)} ms`;
    downloadButton.disabled = false;
    setStatus('success', 'Round trip verified byte-for-byte');
  } catch (error) {
    currentPatch = undefined;
    patchSize.textContent = '—';
    transferSaved.textContent = '—';
    runtimeMs.textContent = '—';
    setStatus(
      'error',
      error instanceof Error ? error.message : 'The patch operation failed'
    );
  } finally {
    generateButton.disabled = false;
    generateButton.classList.remove('is-running');
  }
}

function downloadPatch() {
  if (!currentPatch) {
    return;
  }

  const url = URL.createObjectURL(
    new Blob([currentPatch], { type: 'application/octet-stream' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'playground.patch';
  link.click();
  URL.revokeObjectURL(url);
}

oldPayload.addEventListener('input', updateInputSizes);
newPayload.addEventListener('input', updateInputSizes);
generateButton.addEventListener('click', generatePatch);
downloadButton.addEventListener('click', downloadPatch);

updateInputSizes();
runtimeState.dataset.state = 'ready';
runtimeState.textContent = 'WASM ready';
