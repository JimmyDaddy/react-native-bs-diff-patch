import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv[2];
const packageSpec =
  process.env.PACKAGE_SPEC || 'react-native-bs-diff-patch@latest';

if (!['expo', 'vite'].includes(mode)) {
  throw new Error('Usage: node scripts/test-registry-consumers.mjs <vite|expo>');
}

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), `react-native-bs-diff-patch-${mode}-canary-`)
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || temporaryDirectory,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', ...options.env },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout || ''}${
        result.stderr || ''
      }`
    );
  }

  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function testViteConsumer() {
  await writeFile(
    path.join(temporaryDirectory, 'package.json'),
    `${JSON.stringify(
      { name: 'vite-registry-canary', private: true, type: 'module' },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(temporaryDirectory, 'index.html'),
    '<main id="app"></main><script type="module" src="/src.js"></script>\n'
  );
  await writeFile(
    path.join(temporaryDirectory, 'src.js'),
    [
      "import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';",
      "document.querySelector('#app').textContent = `${typeof diffBytes}:${typeof patchBytes}`;",
    ].join('\n')
  );

  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    packageSpec,
    'vite@latest',
  ]);
  run('npx', ['vite', 'build']);

  assert.equal(
    await exists(path.join(temporaryDirectory, 'dist', 'index.html')),
    true,
    'Vite did not produce dist/index.html'
  );
}

async function testExpoConsumer() {
  await writeFile(
    path.join(temporaryDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'expo-registry-canary',
        version: '1.0.0',
        private: true,
        main: 'node_modules/expo/AppEntry.js',
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(temporaryDirectory, 'app.json'),
    `${JSON.stringify(
      {
        expo: {
          name: 'Registry Canary',
          slug: 'registry-canary',
          version: '1.0.0',
          ios: { bundleIdentifier: 'com.jimmydaddy.bsdiffpatch.canary' },
          android: { package: 'com.jimmydaddy.bsdiffpatch.canary' },
        },
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(temporaryDirectory, 'App.js'),
    [
      "import { Text } from 'react-native';",
      "import { diffBytes } from 'react-native-bs-diff-patch';",
      '',
      'export default function App() {',
      "  return <Text>{typeof diffBytes === 'function' ? 'ready' : 'missing'}</Text>;",
      '}',
    ].join('\n')
  );

  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    'expo@latest',
  ]);
  run('npx', [
    'expo',
    'install',
    '--npm',
    'react',
    'react-native',
    'react-dom',
    'react-native-web',
    '@expo/metro-runtime',
  ]);
  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    packageSpec,
  ]);
  run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist']);
  run('npx', ['expo', 'prebuild', '--no-install', '--clean']);

  assert.equal(
    await exists(path.join(temporaryDirectory, 'dist', 'index.html')),
    true,
    'Expo Web did not produce dist/index.html'
  );
  assert.equal(
    await exists(path.join(temporaryDirectory, 'ios', 'Podfile')),
    true,
    'Expo prebuild did not generate the iOS project'
  );
  assert.equal(
    await exists(path.join(temporaryDirectory, 'android', 'settings.gradle')),
    true,
    'Expo prebuild did not generate the Android project'
  );
}

try {
  if (mode === 'vite') {
    await testViteConsumer();
  } else {
    await testExpoConsumer();
  }
  console.log(`${mode} registry canary passed for ${packageSpec}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
