import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, arch, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), 'react-native-bs-diff-patch-native-benchmark-')
);
const executable = path.join(temporaryDirectory, 'native-benchmark');
const compiler = process.env.CC || 'cc';
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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout || ''}${
        result.stderr || ''
      }`
    );
  }
  return result.stdout.trim();
}

const bzip2Sources = [
  'blocksort.c',
  'bzlib.c',
  'compress.c',
  'crctable.c',
  'decompress.c',
  'huffman.c',
  'randtable.c',
].map((file) => path.join(repositoryDirectory, 'cpp', 'bzlib', file));

try {
  run(compiler, [
    '-std=c11',
    '-O2',
    '-I',
    path.join(repositoryDirectory, 'cpp'),
    path.join(repositoryDirectory, 'cpp', 'benchmark', 'native_benchmark.c'),
    path.join(repositoryDirectory, 'cpp', 'bsdiff.c'),
    path.join(repositoryDirectory, 'cpp', 'bspatch.c'),
    ...bzip2Sources,
    '-o',
    executable,
  ]);

  const results = sizes.map((sizeMiB) => {
    try {
      return {
        status: 'passed',
        ...JSON.parse(run(executable, [String(sizeMiB)])),
      };
    } catch (error) {
      return {
        sizeMiB,
        status: 'failed',
        errorCode: 'ENATIVE',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const failed = results.filter((result) => result.status === 'failed').length;
  const report = {
    generatedAt: new Date().toISOString(),
    runtime: {
      cpu: cpus()[0]?.model || 'unknown',
      compiler: run(compiler, ['--version']).split('\n')[0],
      platform: `${platform()}-${arch()}`,
    },
    workload: {
      description: 'Deterministic files with one changed byte per 4 KiB',
      memoryMetric: 'Peak resident set size for one diff and patch process',
    },
    summary: {
      passed: results.length - failed,
      failed,
    },
    results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.BENCHMARK_OUTPUT) {
    await writeFile(process.env.BENCHMARK_OUTPUT, serialized);
  }
  process.stdout.write(serialized);
  if (failed > 0 && process.env.BENCHMARK_ALLOW_FAILURES !== '1') {
    process.exitCode = 1;
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
