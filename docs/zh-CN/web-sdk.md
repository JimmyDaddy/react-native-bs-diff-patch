# Web 与桌面 WebView SDK

本指南面向浏览器、Tauri 2 WebView 或其他 TypeScript 应用：在不安装
React Native、也不启动 Node sidecar 的情况下使用二进制补丁引擎。SDK 处理的是
字节；桌面应用仍负责文件选择、权限、读写文件、临时路径、任务策略，以及由 Rust
或平台层执行最终替换。

## 使用公开入口

包保留现有 React Native 根入口，并为浏览器消费者提供明确的 ESM 入口：

| 导入路径 | 模块格式 | 用途 |
| --- | --- | --- |
| `react-native-bs-diff-patch/web` | ESM | 浏览器与 WebView 字节 API、Worker job、元数据检查与验证 |
| `react-native-bs-diff-patch/toolkit` | ESM | 与平台无关的 manifest、bundle 与补丁头工具 |
| `react-native-bs-diff-patch` | 条件入口 | 既有 React Native API；浏览器打包器可以选择 browser 条件 |
| `react-native-bs-diff-patch/node` | ESM | Node 文件系统操作和发布工具 |

`/web` 与 `/toolkit` 有意不提供单独的 CommonJS `require` 入口。请使用打包器或原生
ESM 导入。根包继续保留已有 CommonJS 构建，供依赖该路径的消费者使用；这条兼容路径
不会让 WebView 获得基于路径的原生 API。

浏览器资源图属于发布包的一部分。`/web` 入口通过模块 Worker 图加载
`web/bsdiffpatch.browser.mjs` 中的浏览器 WASM 模块。Node 入口继续使用
`web/bsdiffpatch.mjs`，为 `/node` 与 CLI 提供所需的 Node 文件系统支持。不要把两份
产物互相 alias，不要导入仓库源码路径，也不要添加 CDN fallback。Vite 和其他标准 ESM
打包器应保留
`new Worker(new URL('./worker.browser.mjs', import.meta.url), { type: 'module' })` 关系。

## 最小 Vite 或 Tauri 往返

在拥有 WebView 的应用中安装包：

```sh
# 0.5.0 Web SDK 的主安装路径：
npm install react-native-bs-diff-patch@^0.5.0
```

发布前验证本地准备的包时，可以将其替换为 tarball：

```sh
npm install ./react-native-bs-diff-patch-0.5.0.tgz
```

registry 中的 0.4.x 包尚未包含 `/web` 和 `/toolkit` 子路径。发布前验证这些入口时，不要
使用未带版本的 registry 安装命令作为验证依据。

下面的代码只导入公开 Web 入口，执行真实的逐字节往返。它不读取路径，也不需要
React、React Native、Node 或服务器接口：

```ts
import {
  diffBytes,
  inspectPatch,
  patchBytes,
  verifyPatch,
} from 'react-native-bs-diff-patch/web';

const encoder = new TextEncoder();
const baseline = encoder.encode('release=1\nfeature=native\n');
const target = encoder.encode('release=2\nfeature=native,web\n');

const controller = new AbortController();
const patch = await diffBytes(baseline, target, {
  signal: controller.signal,
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  onProgress: ({ phase, progress }) => {
    console.log(phase, progress);
  },
});

const metadata = await inspectPatch(patch);
if (!metadata.valid || metadata.format !== 'ENDSLEY/BSDIFF43') {
  throw new Error('unsupported patch header');
}

const restored = await patchBytes(baseline, patch, {
  maxOutputBytes: 32 * 1024 * 1024,
});
const verification = await verifyPatch(baseline, patch, target, {
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});

if (!verification.verified || restored.length !== target.length) {
  throw new Error('restored bytes do not match the target');
}
```

相同函数也接受 `ArrayBuffer`、任意 `ArrayBufferView`（包括 `DataView`）或
`Blob`/`File`。浏览器选择的文件可以直接传入：

```ts
const patch = await diffBytes(oldFile, newFile);
const patchBlob = new Blob([patch.slice().buffer as ArrayBuffer]);
const restored = await patchBytes(oldFile, patchBlob);
```

结果是新的 `Uint8Array`。TypedArray 的 offset 和长度会被保留，调用结束后调用方的
输入缓冲区仍可使用。Worker 不会接管调用方缓冲区的所有权。`Blob` 与 `File` 会在
Worker 内通过只读 WORKERFS 挂载供 C 核心读取，开始操作前不会在主线程额外生成完整副本。
保存或传输补丁时应保持二进制形式；通过 UTF-8 转换会破坏任意补丁字节。

## Job、取消与清理

需要界面进度、明确的取消操作或独立任务生命周期时，使用二进制 job：

```ts
import { startPatchBytes } from 'react-native-bs-diff-patch/web';

const job = startPatchBytes(oldFile, patchFile, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  onProgress: renderProgress,
});
const unsubscribe = job.onProgress(renderProgress);

cancelButton.onclick = () => void job.cancel();
try {
  const restored = await job.result;
  consume(restored);
} catch (error) {
  if ((error as { code?: string }).code !== 'EABORTED') throw error;
} finally {
  unsubscribe();
}
```

Web 入口的 `startDiff`、`startPatch`、`startDiffBytes` 与 `startPatchBytes` 都是二进制
job API。`result` 返回新的 `Uint8Array`，`cancel()` 只影响当前操作。取消会终止当前
专用 Worker，并以 `EABORTED` 拒绝；它不是用 Promise 超时冒充中断，也不会打断其他 job。
`cancel()` 只有在 `result` 到达终态且 job 清理完成后才会 resolve；`result` 本身会以
`EABORTED` 拒绝。重复取消是安全的；已完成 job 再次取消不会改变其已确定的结果。取消或
失败不会返回半成品结果。

Worker 操作结束时，库会删除由操作拥有的 MEMFS 文件和监听器。共享 Worker 没有公开的
`dispose()`：不带 signal 的调用复用模块 Worker 和缓存的 WASM 模块，带 signal 的调用
使用专用 Worker，并在结束后终止。应用仍需在不再使用时撤销自己的
`URL.createObjectURL()` URL，并释放返回缓冲区的引用。

不带 signal 的调用共享一个串行 Worker 队列。带 signal 的调用（包括 `start*` job
封装）使用专用 Worker，从而隔离取消。SDK 不设置应用级总内存或并发预算；大任务开始
前应由应用限制并发数。

## 限制与内存行为

`maxInputBytes` 与 `maxOutputBytes` 是每个操作可选的保护边界：

- `maxInputBytes` 分别作用于每个输入，不是总内存或输入之和的上限。
- `maxOutputBytes` 作用于生成的补丁或还原输出。应用补丁时，会在解压和分配输出前
  检查补丁声明的目标大小，并再次检查实际结果。
- 限制必须是非负安全整数。非法值以 `EINVAL` 拒绝；超过字节限制以 `ERESOURCE`
  拒绝。

算法和 WebAssembly 适配器的峰值内存可能是输入或输出的数倍。当前生成的浏览器 WASM
构建保留 Emscripten 配置的 2 GiB 最大线性内存设置。这是构建设置，不是 WebAssembly
标准规定的限制，也不是所有引擎的统一硬上限；不保证所有浏览器、Tauri WebView 或设备
都能分配这么多，宿主可能因为自身的 WebAssembly 线性内存或标签页预算更早失败。可识别的分配和内存访问失败归类为
`ERESOURCE`，其他 Worker 或 WebAssembly 失败使用 `EWEBASSEMBLY`。应把目标 WebView
实测的上限作为环境约束，记录已经验证的输入尺寸。不要把 `maxInputBytes` 宣传成总进程
内存保证。工具链或生成的 WASM 构建变化后应重新确认该上限。

## 错误与信任边界

错误是带有尽力分类字符串 `code` 的普通 `Error`。需要分支时使用 code，不要依赖错误
消息文本：

| Code | 含义 |
| --- | --- |
| `EINVAL` | 类型格式错误、不支持的输入类型或非法选项（原生空路径或重复路径也无效；零字节二进制输入有效） |
| `EUNSUPPORTED` | Web Worker 或选择的平台 API 不可用 |
| `EABORTED` | Web signal 或 job 被取消 |
| `ERESOURCE` | 超过输入/输出边界，或可识别的运行时分配限制 |
| `EPATCH` | 补丁头或补丁 payload 损坏或不支持 |
| `EWEBASSEMBLY` | Worker 启动、资源加载或未分类的 WASM 失败 |

`inspectPatch()` 是低成本的头部检查。它从二进制输入最多读取 24 字节头，不应用也不
认证补丁。`/toolkit` 的 `inspectPatchHeader()` 对调用方提供的 `Uint8Array` 具有相同
的只检查头部目的。`valid: true` 只表示 magic 和声明的目标大小头字段在结构上可接受；
不表示压缩 payload 完整、不表示基线正确，也不表示签名有效。替换应用数据前应结合
`verifyPatch()` 与可信摘要/签名策略。

运行时生成和应用支持 `ENDSLEY/BSDIFF43`。`BSDIFF40` 输入会在头部检查时识别为
`format: 'BSDIFF40'`、`valid: false`、`issue: 'LEGACY_FORMAT'`，不会静默应用。已有
Node 转换器仍可用于离线迁移：

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
```

发布前请用准确的基线和目标验证转换后的补丁。补丁格式本身不会标识预期基线。

## Toolkit manifest 与候选选择

Toolkit 不访问文件系统、网络或私钥，只校验和规范化调用方传入的数据：

```ts
import {
  canonicalJson,
  createPatchBundle,
  createPatchManifest,
  selectPatch,
  signingPayload,
} from 'react-native-bs-diff-patch/toolkit';

const manifest = createPatchManifest({
  baseline: { bytes: 1000, sha256: baselineSha256 },
  patch: { bytes: 120, sha256: patchSha256, url: 'release.patch' },
  target: { bytes: 1100, sha256: targetSha256, url: 'app.bin' },
});
const bytesToSign = new TextEncoder().encode(signingPayload(manifest));
const canonical = canonicalJson(manifest);
```

`validatePatchManifest()` 和 `validatePatchBundle()` 检查结构、字节数、SHA-256 形状、
格式与 bundle 目标一致性。但它们不会读取 URL、下载 artifact、计算哈希、验证签名，也
不会证明字节与描述匹配。未知字段会从规范化返回值中丢弃；应用自有字段应放在自己的
外层 envelope 中，或明确使用 schema 支持的 `releaseId`/`signature`。

`canonicalJson()` 会排序对象键并省略对象属性中的 `undefined`。`signingPayload()` 返回
移除 detached signature 元数据后的 canonical JSON。二者都不会签名：canonical JSON 与
signing payload 是外部密码学签名系统的输入，不是数字签名本身。

`selectPatch()` 会先验证 bundle 和选择选项，然后：

1. 将传入的 64 字符 baseline SHA-256 转小写，寻找 digest 完全相同的第一个候选。
2. 没有候选时返回完整 artifact，原因是 `BASELINE_NOT_FOUND`。
3. 超过 `maxPatchBytes` 时返回完整 artifact，原因是 `PATCH_BYTES_EXCEEDED`。
4. 当 `candidate.patch.bytes / max(1, full.bytes)` 大于 `maxPatchRatio` 时返回完整
   artifact，原因是 `PATCH_RATIO_EXCEEDED`。
5. 其他情况返回该第一个匹配候选，原因是 `BASELINE_MATCH`，策略为 `patch`。

该工具不会搜索最小补丁，也不会执行还原。应用必须先认证 manifest，再下载并校验所选
artifact 的摘要，然后按需要运行 `patchBytes()` 和 `verifyPatch()`。

## Vite 与 Tauri 打包检查清单

在应用源码中使用包名，让打包器依据 exports 解析。生产构建必须包含 `/web` 入口的
模块 Worker 与浏览器 WASM 资源图。当前采用单文件 WASM 构建时，二进制 payload 嵌入
生成的浏览器模块；消费者不需要复制独立 `.wasm` 文件，也不需要安装 Emscripten。

发布前应检查生产 bundle，并在断网条件下从构建产物运行，至少确认：

- `react-native-bs-diff-patch/web` 与 `/toolkit` 从安装的 tarball 解析，不使用 workspace
  link、源码 alias 或私有深路径；
- Worker URL 解析到随包发布的同源资源；
- 浏览器 WASM 从包资源图加载，而不是 CDN；
- 断网后生产应用仍能生成、应用和验证补丁；
- 目标 WebView 的 CSP 允许 Worker 与 WebAssembly 执行；
- Rust 或其他桌面层负责文件授权和持久化，JavaScript 只向 SDK 传递字节。

SDK 所需的最小 CSP 增量为：

```text
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
```

请将这些 source 合并到应用现有策略中。不要添加普通 `unsafe-eval`，不要从 CDN 加载
引擎，也不要以放宽策略作为 fallback。本指南只记录所需策略；真实 Tauri WebView 的
接受情况仍由下游应用验收。

## 验证命令

仓库内相关本地检查如下：

```sh
yarn test:web
yarn test:web:browser
yarn test:web:metro
yarn test:toolkit
yarn test:sdk
yarn typecheck
yarn site:build
yarn site:test
```

其中 `yarn test:sdk` 会把准备好的 tarball 安装到隔离消费者中，检查公开 `/web`、
`/toolkit` ESM 入口、生产 Vite 资源加载和字节往返。Registry smoke 属于独立的发布后
检查；这些检查不等于 Tauri 真机验收，也不宣称 registry smoke 已通过。
