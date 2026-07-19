import * as React from 'react';

import { StyleSheet, View, Text } from 'react-native';
import { diff, patch } from 'react-native-bs-diff-patch';
import * as FS from 'react-native-fs';

import crossPlatformFixture from '../../fixtures/cross-platform.json';

export default function App() {
  const architecture = (
    globalThis as typeof globalThis & { nativeFabricUIManager?: unknown }
  ).nativeFabricUIManager
    ? 'new'
    : 'old';
  const newFile = FS.DocumentDirectoryPath + '/test1.txt';
  const oldFile = FS.DocumentDirectoryPath + '/test.txt';
  const patchFile = FS.DocumentDirectoryPath + '/patch.txt';
  const newFile1 = FS.DocumentDirectoryPath + '/test2.txt';
  const goldenOldFile = FS.DocumentDirectoryPath + '/golden-old.bin';
  const goldenNewFile = FS.DocumentDirectoryPath + '/golden-new.bin';
  const goldenPatchFile = FS.DocumentDirectoryPath + '/golden.patch';
  const goldenOutputFile = FS.DocumentDirectoryPath + '/golden-output.bin';
  const generatedGoldenPatchFile =
    FS.DocumentDirectoryPath + '/golden-generated.patch';
  const corruptPatchFile = FS.DocumentDirectoryPath + '/corrupt.patch';
  const corruptOutputFile = FS.DocumentDirectoryPath + '/corrupt-output.bin';

  const [textLength, setTextLength] = React.useState<number | undefined>();
  const [patchFileUri, setPatchFileUri] = React.useState<string | undefined>();
  const [runtimeStatus, setRuntimeStatus] = React.useState('running');

  React.useEffect(() => {
    const oldContent = new Array(1000).fill('Hello World').join(' | ');
    const expectedContent = new Array(1000).fill('Hello World 1').join(' | ');
    let cancelled = false;

    async function runRoundTrip() {
      try {
        await FS.writeFile(oldFile, oldContent);
        await FS.writeFile(newFile, expectedContent);

        if (await FS.exists(patchFile)) {
          await FS.unlink(patchFile);
        }
        if (await FS.exists(newFile1)) {
          await FS.unlink(newFile1);
        }

        for (const file of [
          goldenOldFile,
          goldenNewFile,
          goldenPatchFile,
          goldenOutputFile,
          generatedGoldenPatchFile,
          corruptPatchFile,
          corruptOutputFile,
        ]) {
          if (await FS.exists(file)) {
            await FS.unlink(file);
          }
        }

        const diffResult = await diff(oldFile, newFile, patchFile);
        const patchFileInfo = await FS.stat(patchFile);
        const patchResult = await patch(oldFile, newFile1, patchFile);
        const patchedContent = await FS.readFile(newFile1);

        if (
          diffResult !== 0 ||
          patchResult !== 0 ||
          patchedContent !== expectedContent
        ) {
          throw new Error(
            'diff/patch round trip produced an unexpected result'
          );
        }

        await FS.writeFile(
          goldenOldFile,
          crossPlatformFixture.oldBase64,
          'base64'
        );
        await FS.writeFile(
          goldenNewFile,
          crossPlatformFixture.newBase64,
          'base64'
        );
        await FS.writeFile(
          goldenPatchFile,
          crossPlatformFixture.patchBase64,
          'base64'
        );
        await diff(goldenOldFile, goldenNewFile, generatedGoldenPatchFile);
        const generatedGoldenPatch = await FS.readFile(
          generatedGoldenPatchFile,
          'base64'
        );
        if (generatedGoldenPatch !== crossPlatformFixture.patchBase64) {
          throw new Error('native diff did not match the cross-platform patch');
        }

        await patch(goldenOldFile, goldenOutputFile, goldenPatchFile);
        const restoredGoldenFile = await FS.readFile(
          goldenOutputFile,
          'base64'
        );
        if (restoredGoldenFile !== crossPlatformFixture.newBase64) {
          throw new Error(
            'native patch did not restore the cross-platform fixture'
          );
        }

        await FS.writeFile(
          corruptPatchFile,
          'bm90IGEgYnNkaWZmIHBhdGNo',
          'base64'
        );
        let corruptPatchErrorCode: string | undefined;
        try {
          await patch(goldenOldFile, corruptOutputFile, corruptPatchFile);
        } catch (error) {
          corruptPatchErrorCode = (error as { code?: string }).code;
        }
        if (corruptPatchErrorCode !== 'EPATCH') {
          throw new Error(
            `corrupt patch should reject with EPATCH, got ${String(
              corruptPatchErrorCode
            )}`
          );
        }
        if (await FS.exists(corruptOutputFile)) {
          throw new Error('corrupt patch left a partial output file');
        }

        if (!cancelled) {
          setPatchFileUri(patchFileInfo.path);
          setTextLength(patchedContent.length);
          setRuntimeStatus('success');
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : String(error);
          setRuntimeStatus(`error: ${message}`);
        }
      }
    }

    runRoundTrip();

    return () => {
      cancelled = true;
      FS.exists(oldFile).then((exists) => {
        if (exists) {
          FS.unlink(oldFile);
        }
      });
      FS.exists(newFile).then((exists) => {
        if (exists) {
          FS.unlink(newFile);
        }
      });
    };
  }, [
    corruptOutputFile,
    corruptPatchFile,
    generatedGoldenPatchFile,
    goldenNewFile,
    goldenOldFile,
    goldenOutputFile,
    goldenPatchFile,
    newFile,
    newFile1,
    oldFile,
    patchFile,
  ]);

  return (
    <View style={styles.container}>
      <Text>Text: {textLength}</Text>
      <Text>Patch: {patchFileUri}</Text>
      <Text testID="architecture-status">Architecture: {architecture}</Text>
      <Text testID="runtime-status">Runtime: {runtimeStatus}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 60,
    height: 60,
    marginVertical: 20,
  },
});
