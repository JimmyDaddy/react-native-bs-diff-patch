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

  React.useEffect(() => {
    FS.writeFile(
      FS.DocumentDirectoryPath + '/test.txt',
      new Array(10000).fill('Hello World').join(' | ')
    )
      .then(async () => {
        try {
          await FS.writeFile(
            FS.DocumentDirectoryPath + '/test1.txt',
            new Array(10000).fill('Hello World 1').join(' | ')
          );

          let patchFileExists = await FS.exists(patchFile);

          if (patchFileExists) {
            await FS.unlink(patchFile);
          }
          console.log('write done');
          await diff(oldFile, newFile, patchFile);
          console.log('diff done', patchFile, oldFile, newFile);
          patchFileExists = await FS.exists(patchFile);
          console.log('start patch', patchFileExists);
          const patchFileInfoInner = await FS.stat(patchFile);
          setPatchFileUri(patchFileInfoInner.path);
          const newFile1InfoExists = await FS.exists(newFile1);
          if (newFile1InfoExists) {
            await FS.unlink(newFile1);
          }
          await patch(oldFile, newFile1, patchFile);
          console.log('patch done');
          const t = await FS.readFile(newFile1);
          setTextLength(t.length);
        } catch (error) {
          console.log(error);
        }
      })
      .catch((e) => {
        console.log(e);
      });
    return () => {
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
