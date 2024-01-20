import * as React from 'react';

import { StyleSheet, View, Text } from 'react-native';
import { diff, patch } from 'react-native-bs-diff-patch';
import * as FS from 'expo-file-system';

export default function App() {
  const newFile = FS.documentDirectory + 'test1.txt';
  const oldFile = FS.documentDirectory + 'test.txt';
  const patchFile = FS.documentDirectory + 'patch.txt';
  const newFile1 = FS.documentDirectory + 'test2.txt';

  const [textLength, setTextLength] = React.useState<number | undefined>();
  const [patchFileUri, setPatchFileUri] = React.useState<string | undefined>();

  React.useEffect(() => {
    FS.writeAsStringAsync(
      FS.documentDirectory + 'test.txt',
      new Array(10000).fill('Hello World').join(' | '),
      {
        encoding: FS.EncodingType.UTF8,
      }
    )
      .then(async () => {
        try {
          await FS.writeAsStringAsync(
            FS.documentDirectory + 'test1.txt',
            new Array(10000).fill('Hello World 1').join(' | '),
            {
              encoding: FS.EncodingType.UTF8,
            }
          );

          let patchFileInfoInner = await FS.getInfoAsync(patchFile);

          if (patchFileInfoInner.exists) {
            await FS.deleteAsync(patchFile);
          }
          console.log('write done');
          await diff(oldFile, newFile, patchFile);
          console.log('diff done', patchFile, oldFile, newFile);
          patchFileInfoInner = await FS.getInfoAsync(patchFile);
          console.log('start patch', patchFileInfoInner);
          setPatchFileUri(patchFileInfoInner.uri);
          const newFile1Info = await FS.getInfoAsync(newFile1);
          if (newFile1Info.exists) {
            await FS.deleteAsync(newFile1);
          }
          await patch(oldFile, newFile1, patchFile);
          console.log('patch done');
          const t = await FS.readAsStringAsync(newFile1, {
            encoding: FS.EncodingType.UTF8,
          });
          setTextLength(t.length);
        } catch (error) {
          console.log(error);
        }
      })
      .catch((e) => {
        console.log(e);
      });
    return () => {
      FS.deleteAsync(FS.documentDirectory + 'test.txt');
      FS.deleteAsync(FS.documentDirectory + 'test1.txt');
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
