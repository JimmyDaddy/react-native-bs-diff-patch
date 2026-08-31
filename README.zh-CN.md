# react-native-bs-diff-patch

<p align="center">
  <a href="https://bs-dff-patch.corerobin.com/">
    <img src="https://bs-dff-patch.corerobin.com/assets/social-preview.png" alt="在 Android、iOS 与 Web 上创建和应用兼容的二进制补丁" width="100%" />
  </a>
</p>

<p align="center">
  <strong>面向 React Native、Web、Node.js 与发布 CI 的可验证二进制增量工具链。</strong><br />
  用同一种兼容格式生成紧凑补丁、验证还原字节，并规划多基线分发。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/react-native-bs-diff-patch"><img src="https://img.shields.io/npm/v/react-native-bs-diff-patch?color=b8ff3d&label=npm" alt="npm 版本" /></a>
  <a href="https://www.npmjs.com/package/react-native-bs-diff-patch"><img src="https://img.shields.io/npm/dm/react-native-bs-diff-patch?color=39e6ff" alt="npm 下载量" /></a>
  <a href="https://github.com/JimmyDaddy/react-native-bs-diff-patch/actions/workflows/ci.yml"><img src="https://github.com/JimmyDaddy/react-native-bs-diff-patch/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/react-native-bs-diff-patch?color=f6bf6f" alt="MIT 许可证" /></a>
</p>

<p align="center">
  <a href="https://bs-dff-patch.corerobin.com/docs/zh-CN/">中文文档</a> ·
  <a href="https://bs-dff-patch.corerobin.com/#playground">在线 Playground</a> ·
  <a href="https://bs-dff-patch.corerobin.com/zh-CN/tools/">二进制补丁工具箱</a> ·
  <a href="https://bs-dff-patch.corerobin.com/zh-CN/planner/">发布规划器</a> ·
  <a href="./README.md">English</a> ·
  <a href="https://www.npmjs.com/package/react-native-bs-diff-patch">npm</a>
</p>

## 它解决什么问题？

当应用中已经存在某个文件的旧版本，而你不想再次传输完整新文件时，可以只传输
两个版本之间的二进制补丁。

| 1. 生成差量                                        | 2. 按业务方式分发                            | 3. 还原新文件                                                |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| 比较 `old.bin` 与 `new.bin`，生成 `update.patch`。 | 通过已有 CDN、API 或离线流程存储和传输补丁。 | 将 `update.patch` 应用于 `old.bin`，写出还原后的 `new.bin`。 |

本库只负责二进制差分和还原；补丁传输、身份认证、完整性校验，以及何时替换线上
数据，仍然由你的应用控制。

## 为什么选择它？

- **统一补丁格式：** Android、iOS 与 Web 生成兼容的
  `ENDSLEY/BSDIFF43` 补丁。
- **覆盖 RN 两种架构：** 同时支持旧桥接架构和 TurboModule / 新架构。
- **原生性能，也能运行在浏览器：** JNI / ObjC++ 使用内置 C 核心；React Native
  Web 则通过可复用的 Worker 运行同一核心编译出的 WebAssembly。
- **可控制高成本任务：** 原生 job 支持进度、协作式取消、输入/输出限制，并避免
  暴露未完成的输出文件。
- **Web 无需补丁服务：** 差分和还原完全在浏览器本地执行。
- **检查并证明兼容性：** 原生与 Web 使用相同 API 读取补丁元数据，并验证还原字节。
- **发布端工具：** 通过 `npx` 生成补丁、发布可验证 manifest，并为每个基线选择
  补丁或完整文件回退。

## 平台概览

|          | Android / iOS                             | React Native Web                                |
| -------- | ----------------------------------------- | ----------------------------------------------- |
| 输入     | 绝对文件路径                              | `ArrayBuffer`、TypedArray、`DataView` 或 `Blob` |
| 基础 API | `diff()` / `patch()`                      | `diffBytes()` / `patchBytes()`                  |
| 可控 API | `startDiff()` / `startPatch()`            | 二进制 `startDiff()` / `startPatch()` job       |
| 验证能力 | 路径版 `inspectPatch()` / `verifyPatch()` | 相同 API 的二进制输入                           |
| 执行核心 | JNI / ObjC++ 调用原生 C                   | WASM Worker 运行同一 C 核心                     |

## 发布端 CLI 与 bundle

同一个 npm 包提供面向发布流程的 Node.js CLI：

```sh
npx react-native-bs-diff-patch diff old.bin new.bin -o update.patch
npx react-native-bs-diff-patch verify old.bin update.patch new.bin
npx react-native-bs-diff-patch bundle \
  --from releases/ \
  --to dist/app.bin \
  --out dist/update-bundle
```

`bundle` 会评估每个基线，保留高收益补丁，增加完整文件回退，并写出适合 CDN
选择和 detached signature 的 canonical manifest。CLI 通过 NODEFS 挂载宿主路径，
验证 patch 时使用有界流式核心。也可以直接在浏览器打开
[发布规划器](https://bs-dff-patch.corerobin.com/zh-CN/planner/)体验完整流程。

## 安装

React Native、Node.js 和 CLI 消费者：

```sh
npm install react-native-bs-diff-patch@^0.5.0
```

独立浏览器和桌面 WebView 消费者：

```sh
npm install bs-diff-patch-web@^0.5.0
```

发布前验证本地准备的包时，可以在干净消费者中将对应安装命令替换为 tarball。独立 Web
包使用 `bs-diff-patch-web-0.5.0.tgz`；React Native 包仍使用自己的 tarball。资源图、迁移
和消费者检查详见[Web 与桌面 WebView SDK](./docs/zh-CN/web-sdk.md)。

iOS 还需要安装 Pods，并重新构建原生应用：

```sh
npx pod-install
```

React Native autolinking 会完成原生模块注册。新增原生模块后必须重新构建应用，
只刷新 Metro 不会让模块进入已安装的二进制。

## 原生端：第一次往返

原生 API 使用绝对路径。请通过项目已有的文件系统库，在可写缓存目录或文档目录中
生成唯一输出路径。

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

const patchPath = `${cacheDirectory}/content-v2.patch`;
const restoredPath = `${cacheDirectory}/content-v2.restored`;

await diff(oldFilePath, newFilePath, patchPath);
await patch(oldFilePath, restoredPath, patchPath);
```

输入文件必须已经存在；输出路径不能已经存在；同一次调用中的所有路径必须不同。
两个函数成功时都返回 `0`。

### 进度、取消与资源限制

需要控制任务生命周期时使用 job API：

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
  // await job.cancel(); // 用户主动取消时调用
} finally {
  unsubscribe();
}
```

## Web：第一次往返

独立浏览器、Vite 和 Tauri 消费者应安装 `bs-diff-patch-web` 并导入其 ESM 根入口；它提供
不需要 React Native、Node.js 或 Node sidecar 的字节 API。已有应用可以继续使用
`react-native-bs-diff-patch/web`，该入口仍受支持。资源图、迁移和 CSP 见
[Web 与桌面 WebView SDK](./docs/zh-CN/web-sdk.md)。

```ts
import { diffBytes, patchBytes } from 'bs-diff-patch-web';

const patchBytesValue = await diffBytes(oldFile, newFile, {
  signal: abortController.signal,
  maxInputBytes: 64 * 1024 * 1024,
  onProgress: ({ phase, progress }) => {
    renderProgress(phase, progress);
  },
});
const restoredBytes = await patchBytes(oldFile, patchBytesValue, {
  maxOutputBytes: 64 * 1024 * 1024,
});
```

Web API 返回新的 `Uint8Array`，不会转移或失效调用方的缓冲区。主动取消以
`EABORTED` 拒绝；命中二进制大小限制时以 `ERESOURCE` 拒绝。`Blob` 与 `File`
会只读挂载到 Worker，不需要先在主线程生成完整副本。

Web 端可以用二进制输入调用 `startDiff()` / `startPatch()`，也可以使用明确的
`startDiffBytes()` / `startPatchBytes()` 别名，获得带 `result`、`cancel()` 和
真实 C 核心进度事件的 job。

## 检查并验证补丁

先用 `inspectPatch()` 完成低成本结构检查，再用 `verifyPatch()` 将补丁应用到临时
结果，并与预期目标逐字节比较：

```ts
import { inspectPatch, verifyPatch } from 'react-native-bs-diff-patch';

// Android / iOS 使用路径；Web 使用 File、Blob、ArrayBuffer 或 TypedArray。
const metadata = await inspectPatch(patchPath);
const result = await verifyPatch(oldPath, patchPath, expectedPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

if (!metadata.valid || !result.verified) {
  throw new Error('补丁兼容性验证失败');
}
```

原生验证产生的临时输出始终会被清理。Web 版本按相同顺序传入 `oldFile`、
`patchFile` 与 `expectedFile`。结构有效只用于诊断；替换业务数据前仍应认证更新清单
中的可信哈希。

## API 矩阵

| API                                            | Android | iOS    | Web    |
| ---------------------------------------------- | ------- | ------ | ------ |
| `diff(oldPath, newPath, patchPath)`            | 支持    | 支持   | 不支持 |
| `patch(oldPath, outputPath, patchPath)`        | 支持    | 支持   | 不支持 |
| `startDiff(...)` / `startPatch(...)`           | 路径    | 路径   | 二进制 |
| `startDiffBytes(...)` / `startPatchBytes(...)` | 不支持  | 不支持 | 支持   |
| `diffBytes(oldData, newData, options?)`        | 不支持  | 不支持 | 支持   |
| `patchBytes(oldData, patchData, options?)`     | 不支持  | 不支持 | 支持   |
| `inspectPatch(path 或 binary, options?)`       | 支持    | 支持   | 支持   |
| `verifyPatch(old, patch, expected, options?)`  | 支持    | 支持   | 支持   |
| 旧架构（限 RN 仍提供时）                       | 支持    | 支持   | 不适用 |
| 新架构 / TurboModule                           | 支持    | 支持   | 不适用 |

调用当前平台不可用的 API 会以 `EUNSUPPORTED` 拒绝，不会静默切换成其他输入
模型。

## 生产安全

- 对远程或其他不可信来源的补丁进行身份认证。
- 替换业务数据前，验证还原结果与目标文件完全一致。
- 原生端使用唯一输出路径，并清理不再需要的输出文件。
- 按业务设置资源限制；二进制差分的峰值内存可能达到输入大小的数倍。
- 运行时只接受 `ENDSLEY/BSDIFF43`。已有 `BSDIFF40` 可以通过
  `npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch`
  离线转换，并在发布前完成验证。

完整性校验、补丁下载、跨运行时交换、错误处理与清理模式见
[生产实践](./docs/zh-CN/recipes.md)。

## 已验证的兼容性

CI 覆盖使用 React Native 0.73.11、0.74.7 与 0.86.0 的 Android 和 iOS API 构建，
并运行配置的新架构断言。这些检查不等同于 Tauri WebView 验收或下游真机验收。真实
npm 包消费测试还覆盖 browser、ESM、CommonJS、Metro 与 TypeScript 解析。

## 完整文档

- [Web 与桌面 WebView SDK](./docs/zh-CN/web-sdk.md) — 从 Vite 或 Tauri 使用明确的
  `bs-diff-patch-web` 与其 `/toolkit` 入口，无需 React Native 或 Node sidecar；已有
  `react-native-bs-diff-patch/web` 与 `/toolkit` 消费者继续受支持。
- [快速开始](./docs/zh-CN/getting-started.md)
- [API 参考](./docs/zh-CN/api-reference.md)
- [生产实践](./docs/zh-CN/recipes.md)
- [可验证增量发布工具链](./docs/zh-CN/verified-delta-pipeline.md)
- [平台支持](./docs/zh-CN/platform-support.md)
- [架构与补丁格式](./docs/zh-CN/architecture.md)
- [可控制的原生操作](./docs/zh-CN/native-operations-v03.md)
- [大文件演进路线](./docs/zh-CN/large-files-roadmap.md)
- [常见问题与排障](./docs/zh-CN/troubleshooting.md)
- [开发与验证](./docs/zh-CN/development.md)

## 参与贡献

本地开发流程和质量门禁见 [CONTRIBUTING.md](./CONTRIBUTING.md)。发布记录见
[CHANGELOG.md](./CHANGELOG.md)，安全问题报告流程见 [SECURITY.md](./SECURITY.md)。

## License

MIT
