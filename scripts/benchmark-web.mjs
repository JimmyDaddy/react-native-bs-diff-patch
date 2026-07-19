import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { runOperation } from '../web/operations.mjs';

const mebibyte = 1024 * 1024;
const sizes = (process.env.BENCHMARK_SIZES_MIB || '1,10,50')
  .split(',')
  .map((value) => Number(value.trim()));

if (
  sizes.some(
    (value) => !Number.isSafeInteger(value) || value <= 0 || value > 512
  )
) {
  throw new Error('BENCHMARK_SIZES_MIB must contain integers from 1 to 512');
}

function createInputs(size) {
  const oldData = new Uint8Array(size);
  for (let index = 0; index < oldData.length; index += 1) {
    oldData[index] = (index * 31 + (index >>> 8)) & 0xff;
  }
  const newData = oldData.slice();
  for (let index = 0; index < newData.length; index += 4096) {
    newData[index] ^= 0x5a;
  }
  return { oldData, newData };
}

const warmup = createInputs(64 * 1024);
const initializationStartedAt = performance.now();
await runOperation('diff', warmup.oldData, warmup.newData);
const initializationMs = performance.now() - initializationStartedAt;
const results = [];

for (const sizeMiB of sizes) {
  const { oldData, newData } = createInputs(sizeMiB * mebibyte);
  const diffStartedAt = performance.now();
  const patchData = await runOperation('diff', oldData, newData);
  const diffMs = performance.now() - diffStartedAt;
  const patchStartedAt = performance.now();
  const restoredData = await runOperation('patch', oldData, patchData);
  const patchMs = performance.now() - patchStartedAt;

  if (
    restoredData.byteLength !== newData.byteLength ||
    !restoredData.every((value, index) => value === newData[index])
  ) {
    throw new Error(`Benchmark round trip failed for ${sizeMiB} MiB`);
  }

  results.push({
    sizeMiB,
    diffMs: Number(diffMs.toFixed(1)),
    patchMs: Number(patchMs.toFixed(1)),
    patchBytes: patchData.byteLength,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  runtime: {
    cpu: cpus()[0]?.model || 'unknown',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  },
  workload: {
    description: 'Deterministic buffers with one changed byte per 4 KiB',
    initializationMs: Number(initializationMs.toFixed(1)),
  },
  results,
};
const serializedReport = `${JSON.stringify(report, null, 2)}\n`;

if (process.env.BENCHMARK_OUTPUT) {
  await writeFile(process.env.BENCHMARK_OUTPUT, serializedReport);
}
process.stdout.write(serializedReport);
