# react-native-bs-diff-patch

根据文件的两个版本生成紧凑的二进制补丁，再用旧文件和补丁还原新文件。
Android、iOS 与 React Native Web 共用兼容的 `ENDSLEY/BSDIFF43` 补丁格式。

[中文文档](https://bs-dff-patch.corerobin.com/docs/zh-CN/) ·
[在线 Playground](https://bs-dff-patch.corerobin.com/#playground) ·
[English](./README.md) · [npm](https://www.npmjs.com/package/react-native-bs-diff-patch)

## 为什么使用它？

- **统一补丁格式：** 可以在一个受支持的运行时生成补丁，在另一个运行时应用。
- **兼容 RN 两种架构：** 同时支持旧桥接架构和 TurboModule / 新架构。
- **默认不阻塞 UI：** 原生端使用专用串行队列；Web 端复用模块 Worker 和已初始化的
  WebAssembly 实例，让计算离开页面线程。
- **控制高成本任务：** 原生 job 提供进度、协作式取消、输入/输出限制和原子输出；
  Web 使用 `AbortSignal` 与二进制限制。
- **Web 无需后端服务：** 浏览器直接运行由同一套 C 核心编译而来的 WebAssembly。

| 运行时       | 输入方式       | 生成补丁    | 应用补丁     |
| ------------ | -------------- | ----------- | ------------ |
| Android、iOS | 绝对文件路径   | `diff`      | `patch`      |
| Web          | 内存二进制数据 | `diffBytes` | `patchBytes` |

## 安装

```sh
npm install react-native-bs-diff-patch
```

添加依赖后，iOS 还需要安装 Pods，并重新构建原生应用：

```sh
npx pod-install
```

React Native autolinking 会完成原生模块注册。新增原生依赖后，只刷新 Metro
不能让模块进入已经安装的应用二进制。

## 原生端快速开始

原生 API 使用绝对文件路径。请通过项目已经使用的文件系统库选择可写缓存目录。

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

type NativeRoundTripOptions = {
  oldFilePath: string;
  newFilePath: string;
  cacheDirectory: string;
};

export async function nativeRoundTrip({
  oldFilePath,
  newFilePath,
  cacheDirectory,
}: NativeRoundTripOptions) {
  const runId = Date.now();
  const patchPath = `${cacheDirectory}/update-${runId}.patch`;
  const restoredPath = `${cacheDirectory}/restored-${runId}.bin`;

  await diff(oldFilePath, newFilePath, patchPath);
  await patch(oldFilePath, restoredPath, patchPath);

  return { patchPath, restoredPath };
}
```

输出路径不能已经存在，同一次调用中的所有路径必须不同，所需输入文件必须已经
写入完成。两个函数成功时都返回 `0`。

需要进度、取消或资源边界时使用 job API：

```ts
import { startPatch } from 'react-native-bs-diff-patch';

const job = startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});
const unsubscribe = job.onProgress(({ phase, progress }) => {
  renderProgress(phase, progress);
});

try {
  await job.result;
} finally {
  unsubscribe();
}
```

## React Native Web 快速开始

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

export async function webRoundTrip(
  oldFile: File,
  newFile: File,
  signal?: AbortSignal
) {
  const oldData = await oldFile.arrayBuffer();
  const newData = await newFile.arrayBuffer();
  const options = {
    signal,
    maxInputBytes: 64 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
  };
  const patchData = await diffBytes(oldData, newData, options);
  const restoredData = await patchBytes(oldData, patchData, options);

  return { patchData, restoredData };
}
```

`diffBytes` 和 `patchBytes` 接受 `ArrayBuffer`、任意 `ArrayBufferView`
（包括 TypedArray 和 `DataView`）或 `Blob`。它们返回新的 `Uint8Array`，且不会
转移或失效调用方传入的缓冲区。取消以 `EABORTED` 拒绝，命中配置的大小上限时以
`ERESOURCE` 拒绝。

## 平台能力矩阵

| API                                        | Android | iOS    | Web    |
| ------------------------------------------ | ------- | ------ | ------ |
| `diff(oldPath, newPath, patchPath)`        | 支持    | 支持   | 不支持 |
| `patch(oldPath, outputPath, patchPath)`    | 支持    | 支持   | 不支持 |
| `startDiff(...)` / `startPatch(...)`       | 支持    | 支持   | 不支持 |
| `diffBytes(oldData, newData, options?)`    | 不支持  | 不支持 | 支持   |
| `patchBytes(oldData, patchData, options?)` | 不支持  | 不支持 | 支持   |
| 旧架构（限 RN 仍提供时）                   | 支持    | 支持   | 不适用 |
| 新架构 / TurboModule                       | 支持    | 支持   | 不适用 |

调用当前平台不可用的 API 会以 `EUNSUPPORTED` 拒绝，不会静默切换成其他行为。

## 生产环境检查清单

- 替换业务数据前，验证还原结果与目标文件完全一致。
- 对远程或其他不可信来源的补丁进行来源认证和完整性校验。
- 原生端使用唯一输出路径，并在成功或失败后清理临时文件。
- 按业务设置输入大小和执行时间限制；二进制差分的峰值内存可能达到输入大小的数倍。
- 使用本库配套生成和应用补丁；通用 `BSDIFF40` 补丁与
  `ENDSLEY/BSDIFF43` 不兼容。

错误处理、补丁下载、跨运行时交换和完整性校验示例见
[生产实践](./docs/zh-CN/recipes.md)。

CI 会直接使用 React Native 0.73.11、0.74.7 与 0.86.0 编译 Android 新架构
源码。真实 npm tarball 消费测试还会验证 browser、ESM、CommonJS 与 TypeScript
解析，并确保仅使用 Web 的消费者不会被强制安装可选 React Native peer。

## 完整文档

- [快速开始](./docs/zh-CN/getting-started.md)
- [API 参考](./docs/zh-CN/api-reference.md)
- [生产实践](./docs/zh-CN/recipes.md)
- [平台支持](./docs/zh-CN/platform-support.md)
- [架构与补丁格式](./docs/zh-CN/architecture.md)
- [可控制的原生操作](./docs/zh-CN/native-operations-v03.md)
- [常见问题与排障](./docs/zh-CN/troubleshooting.md)
- [开发与验证](./docs/zh-CN/development.md)

## 参与贡献

本地开发流程和质量门禁见 [CONTRIBUTING.md](./CONTRIBUTING.md)。发布记录见
[CHANGELOG.md](./CHANGELOG.md)，安全问题报告流程见 [SECURITY.md](./SECURITY.md)。

## License

MIT
