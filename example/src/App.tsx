import * as React from 'react';

import { StyleSheet, View, Text } from 'react-native';
import { diff, patch } from 'react-native-bs-diff-patch';
import * as FS from 'react-native-fs';

export default function App() {
  const newFile = FS.DocumentDirectoryPath + '/test1.txt';
  const oldFile = FS.DocumentDirectoryPath + '/test.txt';
  const patchFile = FS.DocumentDirectoryPath + '/patch.txt';
  const newFile1 = FS.DocumentDirectoryPath + '/test2.txt';

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
  }, [newFile, newFile1, oldFile, patchFile]);

  return (
    <View style={styles.container}>
      <Text>Text: {textLength}</Text>
      <Text>Patch: {patchFileUri}</Text>
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
