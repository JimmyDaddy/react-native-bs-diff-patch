# 快速开始

本指南会完成依赖安装、API 选择和一次完整的补丁生成与还原。

## 安装

```sh
npm install react-native-bs-diff-patch
```

新增或升级原生依赖后安装 iOS Pods：

```sh
npx pod-install
```

React Native autolinking 会完成 Android 与 iOS 注册。安装后必须重新构建原生应用；
刷新 Metro 不会改变已经安装的应用二进制中包含的原生模块。

## 按运行时选择 API

| 运行时       | 应使用                      | 不应使用       |
| ------------ | --------------------------- | -------------- |
| Android、iOS | `diff` 和 `patch`           | 二进制数据 API |
| Web          | `diffBytes` 和 `patchBytes` | 文件路径 API   |

不可用的 API 族会以 `EUNSUPPORTED` 拒绝，便于发现入口解析到了错误平台。

## 原生文件流程

原生 API 使用绝对文件路径。本库不会选择存储目录，也不会管理文件生命周期；请使用
应用已有的文件系统方案。

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
  const patchPath = `${cacheDirectory}/release-${runId}.patch`;
  const restoredPath = `${cacheDirectory}/release-${runId}.restored`;

  await diff(oldFilePath, newFilePath, patchPath);
  await patch(oldFilePath, restoredPath, patchPath);

  return { patchPath, restoredPath };
}
```

调用 `diff` 前：

- `oldFilePath` 和 `newFilePath` 必须存在。
- `patchPath` 必须不存在。
- 三个路径必须非空且互不相同。

调用 `patch` 前：

- `oldFilePath` 和 `patchPath` 必须存在。
- `restoredPath` 必须不存在。
- 三个路径必须非空且互不相同。

使用文件系统层提供的内容哈希或字节比较验证 `restoredPath` 与 `newFilePath` 一致。
补丁和还原文件不再需要时应及时清理。

## Web 二进制流程

React Native Web 使用二进制值而不是文件路径：

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

const encoder = new TextEncoder();
const oldData = encoder.encode('version 1');
const newData = encoder.encode('version 2 with web support');

const patchData = await diffBytes(oldData, newData);
const restoredData = await patchBytes(oldData, patchData);

const matches =
  restoredData.length === newData.length &&
  restoredData.every((byte, index) => byte === newData[index]);

if (!matches) {
  throw new Error('Patch round trip did not reproduce the target data');
}
```

输入在传给模块 Worker 前会被复制，因此调用方持有的缓冲区仍可继续使用。每次调用
都会返回新的 `Uint8Array`。

## 使用浏览器文件

```ts
import { diffBytes } from 'react-native-bs-diff-patch';

export async function downloadPatch(oldFile: File, newFile: File) {
  const patchData = await diffBytes(oldFile, newFile);
  const url = URL.createObjectURL(
    new Blob([patchData], { type: 'application/octet-stream' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'update.patch';
  link.click();
  URL.revokeObjectURL(url);
}
```

Web API 只能在客户端调用。在 SSR 阶段导入不会创建 Worker，但应等浏览器的
`Worker` 可用后再执行二进制 API。

## 下一步

- 从[生产实践](/docs/zh-CN/recipes/)复制错误恢复模式。
- 在 [API 参考](/docs/zh-CN/api-reference/)中查看全部签名和错误码。
- 确认[平台与打包器支持](/docs/zh-CN/platform-support/)。
- 尝试[在线 Playground](https://bs-dff-patch.corerobin.com/#playground)。
