# bs-diff-patch-web

`bs-diff-patch-web` 是面向浏览器、Vite 和桌面 WebView 的独立 ESM 包，用于在本地执行
二进制补丁操作。它不需要 React Native、Node.js、Node sidecar 或原生源码。

该包与 `react-native-bs-diff-patch` 共用同一份已检入的 C 与 bzip2 源码，但独立发布。
Web 包的 0.5.0 release 使用 `web-v0.5.0` tag；已有 React Native 包继续使用独立的
`v0.5.0` release，并保持支持。

## 安装

```sh
npm install bs-diff-patch-web@^0.5.0
```

发布前验证时，可在干净消费者中安装包构建生成的 tarball：

```sh
npm install ./bs-diff-patch-web-0.5.0.tgz
```

tarball 命令用于验证包本身，不需要 workspace link、源码 alias 或私有深路径。

## 公开入口

| 导入路径                    | 格式 | 用途                                                                |
| --------------------------- | ---- | ------------------------------------------------------------------- |
| `bs-diff-patch-web`         | ESM  | 浏览器与 WebView 字节 API、Worker job、进度、取消、限制、检查与验证 |
| `bs-diff-patch-web/toolkit` | ESM  | 与平台无关的 manifest、bundle、候选选择、规范化和补丁头工具         |

两个入口都只提供 ESM。该包有意不提供 CommonJS `require` 入口、Node 文件系统 API 或
CLI。已有的 `react-native-bs-diff-patch` 继续作为 React Native 兼容路径，以及 `/node`
入口和 CLI 的来源。

该包没有 runtime `dependencies`，也没有 `peerDependencies`。生成的浏览器模块和 Worker
资源由包构建流程纳入发布包。消费者应导入包名，让 Vite 或其他 ESM 打包器遵循 exports；
不要导入仓库路径，也不要从 CDN 加载引擎。

## 字节操作

```ts
import {
  diffBytes,
  inspectPatch,
  patchBytes,
  verifyPatch,
} from 'bs-diff-patch-web';

const encoder = new TextEncoder();
const baseline = encoder.encode('release=1\nfeature=native\n');
const target = encoder.encode('release=2\nfeature=native,web\n');

const patch = await diffBytes(baseline, target, {
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  onProgress: ({ phase, progress }) => console.log(phase, progress),
});

const metadata = await inspectPatch(patch);
if (!metadata.valid || metadata.format !== 'ENDSLEY/BSDIFF43') {
  throw new Error('unsupported patch header');
}

const restored = await patchBytes(baseline, patch, {
  maxOutputBytes: 32 * 1024 * 1024,
});
const verification = await verifyPatch(baseline, patch, target);

if (!verification.verified || restored.length !== target.length) {
  throw new Error('restored bytes do not match the target');
}
```

`diffBytes`、`patchBytes`、`inspectPatch` 与 `verifyPatch` 接受 `ArrayBuffer`、任意
`ArrayBufferView`（包括 `DataView`）或 `Blob`/`File`。零字节二进制输入有效；React Native
包中的原生路径 API 另行拒绝空路径字符串。结果是新的 `Uint8Array`，Worker 不会接管调用方
缓冲区的所有权。`Blob` 与 `File` 会在 Worker 中通过 WORKERFS 只读挂载供 C 核心读取；
应用仍负责自己的 object URL 和返回缓冲区引用。

保存或传输补丁时应保持二进制形式。将任意补丁字节转换为 UTF-8 可能破坏补丁。

## Job、取消与限制

界面需要进度或明确的 Cancel 操作时使用 job：

```ts
import { startPatch } from 'bs-diff-patch-web';

const job = startPatch(oldFile, patchFile, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  onProgress: renderProgress,
});

const unsubscribe = job.onProgress(renderProgress);
try {
  const restored = await job.result;
  consume(restored);
} catch (error) {
  if ((error as { code?: string }).code !== 'EABORTED') throw error;
} finally {
  unsubscribe();
}
```

`startDiff`、`startPatch`、`startDiffBytes` 与 `startPatchBytes` 使用相同的二进制 job
契约。带 signal 或 job 封装的调用使用专用 Worker，因此取消只影响当前任务。`result`
成功时返回新的 `Uint8Array`；取消后的 `result` 以 `EABORTED` 拒绝。`cancel()` 只有在
`result` 到达终态且 Worker/监听器清理完成后才 resolve。重复调用 `cancel()` 是安全的；
已完成的 job 再次取消不会改变其已确定的结果。

不带 signal 的调用共享串行 Worker 队列。SDK 不设置应用级总内存或并发预算；应用应限制
大任务并发，并释放自己的 Blob URL 和缓冲区引用。

`maxInputBytes` 分别作用于每个输入，不是输入总和或进程总内存上限。`maxOutputBytes`
会在解压和分配补丁声明的目标之前检查，并再次检查实际结果。限制必须是非负安全整数；
非法值以 `EINVAL` 拒绝，超过限制以 `ERESOURCE` 拒绝。

当前浏览器构建保留 Emscripten 配置的 2 GiB 最大线性内存设置。这是构建设置，不是
WebAssembly 标准规定的限制，也不是所有引擎的统一硬上限。浏览器、WebView 或设备可能
因为自身的 WebAssembly 或标签页内存预算更早失败；可识别的分配和内存访问失败归类为
`ERESOURCE`。

## 错误与补丁格式

错误是带有尽力分类字符串 `code` 的普通 `Error`。需要分支时使用 code，不要依赖错误消息：

| Code           | 含义                                         |
| -------------- | -------------------------------------------- |
| `EINVAL`       | 输入类型或选项无效；零字节二进制输入仍然有效 |
| `EUNSUPPORTED` | Worker 或所选平台 API 不可用                 |
| `EABORTED`     | Web signal 或 job 被取消                     |
| `ERESOURCE`    | 输入/输出限制或可识别的运行时分配限制被超过  |
| `EPATCH`       | 补丁头或 payload 损坏或不支持                |
| `EWEBASSEMBLY` | Worker 启动、资源加载或其他未分类 WASM 失败  |

运行时生成和应用使用 `ENDSLEY/BSDIFF43`。头部检查会将 `BSDIFF40` 识别为
`valid: false`、`issue: 'LEGACY_FORMAT'`，不会静默应用该格式。转换器和 Node CLI 仍在
`react-native-bs-diff-patch` 中：

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
```

`inspectPatch` 和 `inspectPatchHeader` 只做结构化头部检查。`valid: true` 不表示压缩
payload、基线、摘要或签名正确。替换应用数据前必须运行 `verifyPatch()` 并遵循应用自己的
可信摘要/签名策略。

## Toolkit 信任边界

```ts
import {
  canonicalJson,
  createPatchBundle,
  createPatchManifest,
  selectPatch,
  signingPayload,
} from 'bs-diff-patch-web/toolkit';
```

Toolkit 与平台无关，不读取文件、不下载 URL、不计算哈希、不访问私钥、不验证签名，也不
证明字节与 manifest 一致。它只校验和规范化调用方提供的结构；未知字段会从规范化结果中
丢弃。

`canonicalJson()` 与 `signingPayload()` 生成确定性的签名输入；二者都不会执行数字签名。
数组循环以 `EINVALID_MANIFEST` 拒绝，规范化时保留字面量 `__proto__` 对象键。
`selectPatch()` 会先校验选择选项再查找基线，返回第一个 digest 精确匹配，并对该候选应用
字节和比例预算；它不会搜索最小补丁。即使没有匹配基线，非法预算也会拒绝。

## 打包与 CSP

在应用源码中使用包名，让生产打包器遵循 exports。包构建会包含浏览器 Worker 和 WASM
资源图；消费者不需要 Emscripten 或独立 `.wasm` 文件。应在断网条件下运行生产 bundle，
确认 Worker 与 WASM 从同源包资源加载。

浏览器或 WebView 所需的最小 CSP 增量为：

```text
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
```

请将这些指令合并到应用已有策略中。不要添加普通 `unsafe-eval`、使用 CDN fallback，或把
文件授权、持久化、临时文件和最终替换移入本包。真实 Tauri WebView 验收仍由下游应用负责。

## 从 React Native 包迁移

已有 `react-native-bs-diff-patch` 消费者可以继续使用其根入口、`/web` 和 `/toolkit`。这些
入口没有弃用，也不会因为本包存在而重新发布。若 Web-only 应用希望依赖图中不包含 React
Native 包：

1. 安装 `bs-diff-patch-web@^0.5.0`；
2. 将 Web 字节导入从 `react-native-bs-diff-patch/web` 改为 `bs-diff-patch-web`；
3. 将 toolkit 导入从 `react-native-bs-diff-patch/toolkit` 改为
   `bs-diff-patch-web/toolkit`；
4. Node 文件系统操作、CLI 和 BSDIFF40 转换器继续使用 `react-native-bs-diff-patch`。

两个 Web 入口面的字节 ownership、Worker 生命周期、资源限制、错误、补丁格式和 toolkit
信任规则相同。本包不宣称 Tauri 或下游移动端验收通过；这些应用应在自己的环境中验证。
