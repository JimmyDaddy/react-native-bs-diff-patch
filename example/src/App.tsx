import * as React from 'react';

import { StyleSheet, View, Text } from 'react-native';
import {
  diff,
  inspectPatch,
  patch,
  startDiff,
  startPatch,
  type NativeOperationProgress,
  verifyPatch,
} from 'react-native-bs-diff-patch';
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
  const controlledOldFile = FS.DocumentDirectoryPath + '/controlled-old.bin';
  const controlledNewFile = FS.DocumentDirectoryPath + '/controlled-new.bin';
  const controlledPatchFile = FS.DocumentDirectoryPath + '/controlled.patch';
  const controlledOutputFile =
    FS.DocumentDirectoryPath + '/controlled-output.bin';
  const cancelledPatchFile = FS.DocumentDirectoryPath + '/cancelled.patch';
  const limitedPatchFile = FS.DocumentDirectoryPath + '/limited.patch';
  const limitedOutputFile = FS.DocumentDirectoryPath + '/limited-output.bin';

  const [textLength, setTextLength] = React.useState<number | undefined>();
  const [patchFileUri, setPatchFileUri] = React.useState<string | undefined>();
  const [runtimeStatus, setRuntimeStatus] = React.useState('running');
  const [controlsStatus, setControlsStatus] = React.useState('running');

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
          controlledOldFile,
          controlledNewFile,
          controlledPatchFile,
          controlledOutputFile,
          cancelledPatchFile,
          limitedPatchFile,
          limitedOutputFile,
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
        const goldenNewFileInfo = await FS.stat(goldenNewFile);
        const goldenMetadata = await inspectPatch(goldenPatchFile, {
          maxInputBytes: 1024 * 1024,
        });
        if (
          !goldenMetadata.valid ||
          goldenMetadata.format !== 'ENDSLEY/BSDIFF43' ||
          goldenMetadata.declaredTargetBytes !== String(goldenNewFileInfo.size)
        ) {
          throw new Error('native patch metadata did not match the fixture');
        }
        const goldenVerification = await verifyPatch(
          goldenOldFile,
          goldenPatchFile,
          goldenNewFile,
          {
            maxInputBytes: 1024 * 1024,
            maxOutputBytes: 1024 * 1024,
          }
        );
        if (
          !goldenVerification.verified ||
          goldenVerification.patch.declaredTargetBytes !==
            String(goldenNewFileInfo.size)
        ) {
          throw new Error(
            'native patch verification did not match the fixture'
          );
        }
        const mismatchVerification = await verifyPatch(
          goldenOldFile,
          goldenPatchFile,
          oldFile
        );
        if (mismatchVerification.verified) {
          throw new Error('native patch verification accepted a wrong target');
        }
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
        const corruptMetadata = await inspectPatch(corruptPatchFile);
        if (
          corruptMetadata.valid ||
          corruptMetadata.issue !== 'TRUNCATED_HEADER'
        ) {
          throw new Error('native patch inspection accepted a corrupt patch');
        }
        const corruptVerificationCode = await verifyPatch(
          goldenOldFile,
          corruptPatchFile,
          goldenNewFile
        ).then(
          () => undefined,
          (error: { code?: string }) => error.code
        );
        if (corruptVerificationCode !== 'EPATCH') {
          throw new Error(
            `corrupt verification should reject with EPATCH, got ${String(
              corruptVerificationCode
            )}`
          );
        }
        const verificationLimitCode = await verifyPatch(
          goldenOldFile,
          goldenPatchFile,
          goldenNewFile,
          { maxOutputBytes: 1 }
        ).then(
          () => undefined,
          (error: { code?: string }) => error.code
        );
        if (verificationLimitCode !== 'ERESOURCE') {
          throw new Error(
            `verification limit should reject with ERESOURCE, got ${String(
              verificationLimitCode
            )}`
          );
        }
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

        const controlledOldContent = new Array(65_536)
          .fill('native-controls-old')
          .join('|');
        const controlledNewContent = `${controlledOldContent.slice(
          0,
          -64
        )}native-controls-new-${Date.now()}`;
        await FS.writeFile(controlledOldFile, controlledOldContent);
        await FS.writeFile(controlledNewFile, controlledNewContent);

        const progressEvents: NativeOperationProgress[] = [];
        const controlledDiff = startDiff(
          controlledOldFile,
          controlledNewFile,
          controlledPatchFile,
          { maxInputBytes: controlledOldContent.length * 2 }
        );
        const unsubscribe = controlledDiff.onProgress((event) => {
          progressEvents.push(event);
        });
        try {
          await controlledDiff.result;
        } finally {
          unsubscribe();
        }
        if (
          progressEvents.length === 0 ||
          progressEvents.some(
            (event, index) =>
              index > 0 && event.progress < progressEvents[index - 1]!.progress
          )
        ) {
          throw new Error('native progress was missing or non-monotonic');
        }

        const controlledPatch = startPatch(
          controlledOldFile,
          controlledOutputFile,
          controlledPatchFile,
          { maxOutputBytes: controlledNewContent.length * 2 }
        );
        await controlledPatch.result;
        if (
          (await FS.readFile(controlledOutputFile)) !== controlledNewContent
        ) {
          throw new Error('controlled patch did not restore the expected file');
        }

        const inputLimitCode = await startDiff(
          controlledOldFile,
          controlledNewFile,
          limitedPatchFile,
          { maxInputBytes: 1 }
        ).result.then(
          () => undefined,
          (error: { code?: string }) => error.code
        );
        if (inputLimitCode !== 'EINPUT_TOO_LARGE') {
          throw new Error(
            `input limit should reject with EINPUT_TOO_LARGE, got ${String(
              inputLimitCode
            )}`
          );
        }

        const outputLimitCode = await startPatch(
          controlledOldFile,
          limitedOutputFile,
          controlledPatchFile,
          { maxOutputBytes: 1 }
        ).result.then(
          () => undefined,
          (error: { code?: string }) => error.code
        );
        if (outputLimitCode !== 'EOUTPUT_TOO_LARGE') {
          throw new Error(
            `output limit should reject with EOUTPUT_TOO_LARGE, got ${String(
              outputLimitCode
            )}`
          );
        }

        const cancelledDiff = startDiff(
          controlledOldFile,
          controlledNewFile,
          cancelledPatchFile
        );
        const cancellationCode = cancelledDiff.result.then(
          () => undefined,
          (error: { code?: string }) => error.code
        );
        await cancelledDiff.cancel();
        if ((await cancellationCode) !== 'ECANCELLED') {
          throw new Error('cancelled operation should reject with ECANCELLED');
        }
        if (
          (await FS.exists(cancelledPatchFile)) ||
          (await FS.exists(limitedPatchFile)) ||
          (await FS.exists(limitedOutputFile))
        ) {
          throw new Error('cancelled or limited operation left an output file');
        }

        if (!cancelled) {
          setPatchFileUri(patchFileInfo.path);
          setTextLength(patchedContent.length);
          setRuntimeStatus('success');
          setControlsStatus('success');
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : String(error);
          setRuntimeStatus(`error: ${message}`);
          setControlsStatus(`error: ${message}`);
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
    controlledNewFile,
    controlledOldFile,
    controlledOutputFile,
    controlledPatchFile,
    cancelledPatchFile,
    generatedGoldenPatchFile,
    goldenNewFile,
    goldenOldFile,
    goldenOutputFile,
    goldenPatchFile,
    limitedOutputFile,
    limitedPatchFile,
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
      <Text testID="controls-status">Controls: {controlsStatus}</Text>
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
