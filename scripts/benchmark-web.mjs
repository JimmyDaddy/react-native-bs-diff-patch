import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { runOperation } from '../web/operations.mjs';

const mebibyte = 1024 * 1024;
const scriptPath = fileURLToPath(import.meta.url);
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

function toMiB(bytes) {
  return Number((bytes / mebibyte).toFixed(1));
}

async function runSample(sizeMiB) {
  try {
    const warmup = createInputs(64 * 1024);
    const initializationStartedAt = performance.now();
    await runOperation('diff', warmup.oldData, warmup.newData);
    const initializationMs = performance.now() - initializationStartedAt;
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

    const memory = process.memoryUsage();
    return {
      sizeMiB,
      status: 'passed',
      initializationMs: Number(initializationMs.toFixed(1)),
      diffMs: Number(diffMs.toFixed(1)),
      patchMs: Number(patchMs.toFixed(1)),
      patchBytes: patchData.byteLength,
      peakRssMiB: toMiB(process.resourceUsage().maxRSS * 1024),
      residentAfterMiB: toMiB(memory.rss),
      externalAfterMiB: toMiB(memory.external),
      arrayBuffersAfterMiB: toMiB(memory.arrayBuffers),
    };
  } catch (error) {
    return {
      sizeMiB,
      status: 'failed',
      errorCode: error?.code || 'EBENCHMARK',
      errorMessage: error instanceof Error ? error.message : String(error),
      peakRssMiB: toMiB(process.resourceUsage().maxRSS * 1024),
    };
  }
}

async function main() {
  if (process.argv[2] === '--sample') {
    const sizeMiB = Number(process.argv[3]);
    if (!Number.isSafeInteger(sizeMiB) || sizeMiB <= 0 || sizeMiB > 512) {
      throw new Error('Sample size must be an integer from 1 to 512 MiB');
    }
    process.stdout.write(`${JSON.stringify(await runSample(sizeMiB))}\n`);
    return;
  }

  const results = sizes.map((sizeMiB) => {
    const sample = spawnSync(
      process.execPath,
      [scriptPath, '--sample', String(sizeMiB)],
      {
        encoding: 'utf8',
        env: { ...process.env, BENCHMARK_OUTPUT: '' },
        maxBuffer: 10 * mebibyte,
      }
    );
    if (sample.status !== 0 || !sample.stdout.trim()) {
      return {
        sizeMiB,
        status: 'failed',
        errorCode: 'EPROCESS',
        errorMessage: (sample.stderr || sample.stdout || 'process failed')
          .trim()
          .slice(0, 2000),
      };
    }
    return JSON.parse(sample.stdout);
  });
  const failed = results.filter((result) => result.status === 'failed').length;
  const report = {
    generatedAt: new Date().toISOString(),
    runtime: {
      cpu: cpus()[0]?.model || 'unknown',
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    workload: {
      description: 'Deterministic buffers with one changed byte per 4 KiB',
      memoryMetric:
        'Peak resident set size for one initialized WebAssembly diff and patch process',
      processIsolation: 'Each input size runs in a fresh Node.js process',
    },
    summary: {
      passed: results.length - failed,
      failed,
    },
    results,
  };
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;

  if (process.env.BENCHMARK_OUTPUT) {
    await writeFile(process.env.BENCHMARK_OUTPUT, serializedReport);
  }
  process.stdout.write(serializedReport);
  if (failed > 0 && process.env.BENCHMARK_ALLOW_FAILURES !== '1') {
    process.exitCode = 1;
  }
}

await main();
