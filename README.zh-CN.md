# react-native-bs-diff-patch

在 Android、iOS 和 React Native Web 上生成与应用紧凑的二进制补丁。原生端通过
JNI / Objective-C++ 调用项目内置的 C 实现；Web 端将同一套实现编译为
WebAssembly，并在独立 Web Worker 中执行。

[在线文档](https://bs-dff-patch.corerobin.com/docs/) ·
[在线 Playground](https://bs-dff-patch.corerobin.com/#playground) ·
[English](./README.md)

## 能力概览

- Android、iOS、Web 共用 `ENDSLEY/BSDIFF43` 补丁格式。
- 支持 React Native 旧架构与 TurboModule / 新架构。
- 原生端使用专用串行工作队列，Web 端使用 Web Worker，避免阻塞 UI。
- 原生端提供文件路径 API，Web 端提供强类型二进制 API。
- 提供 TypeScript 类型、WASM 往返测试、真实浏览器测试和 Metro Web 入口测试。

## 安装

```sh
npm install react-native-bs-diff-patch
```

iOS 项目安装依赖后还需要执行：

```sh
npx pod-install
```

## 原生端用法

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

const patchPath = `${cacheDirectory}/update.patch`;
const restoredPath = `${cacheDirectory}/restored.bin`;

await diff(oldFilePath, newFilePath, patchPath);
await patch(oldFilePath, restoredPath, patchPath);
```

`diff` 要求旧文件和新文件已经存在，补丁路径尚未创建；`patch` 要求旧文件和补丁
已经存在，输出路径尚未创建。成功时均返回 `0`。

## React Native Web 用法

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

const oldData = await oldFile.arrayBuffer();
const newData = await newFile.arrayBuffer();

const patchData = await diffBytes(oldData, newData);
const restoredData = await patchBytes(oldData, patchData);
```

`diffBytes` 和 `patchBytes` 接受 `ArrayBuffer`、任意 `ArrayBufferView`
（包括 TypedArray 和 `DataView`）或 `Blob`，返回 `Uint8Array`。

## 平台能力

| API                                     | Android | iOS    | Web    |
| --------------------------------------- | ------- | ------ | ------ |
| `diff(oldPath, newPath, patchPath)`     | 支持    | 支持   | 不支持 |
| `patch(oldPath, outputPath, patchPath)` | 支持    | 支持   | 不支持 |
| `diffBytes(oldData, newData)`           | 不支持  | 不支持 | 支持   |
| `patchBytes(oldData, patchData)`        | 不支持  | 不支持 | 支持   |
| 旧架构                                  | 支持    | 支持   | 不适用 |
| 新架构 / TurboModule                    | 支持    | 支持   | 不适用 |

调用当前平台不支持的 API 会以 `EUNSUPPORTED` 拒绝。

## 完整文档

- [快速开始](./docs/getting-started.md)
- [API 参考](./docs/api-reference.md)
- [平台支持](./docs/platform-support.md)
- [架构与补丁格式](./docs/architecture.md)
- [常见问题与排障](./docs/troubleshooting.md)
- [开发与验证](./docs/development.md)

## 资源与安全边界

二进制差分会消耗较多 CPU 和内存。虽然本库已经把原生计算移出 React Native 模块
队列，并在 Web 端使用 Worker，业务仍应按自身场景限制文件大小、执行时间和输入
来源。应用来自不可信来源的补丁前，应先验证补丁的来源与完整性。

## License

MIT
