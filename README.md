# react-native-bs-diff-patch

rn bs diff patch file

## Installation

```sh
npm install react-native-bs-diff-patch
```

## Usage

```js
import { diff, patch } from 'react-native-bs-diff-patch';

// ...

/**
 * generate patch file from old file and new file
 */
await diff(oldFile, newFile, patchFile);
// generate new file from old file and patch file
await patch(oldFile, newFile, patchFile);

```

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
