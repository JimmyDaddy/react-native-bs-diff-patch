# API 参考

包提供两组平台专用 API。已有共享代码可以导入根包并依赖其 React Native/browser
条件解析；独立浏览器和桌面 WebView 消费者应使用明确的
`react-native-bs-diff-patch/web` ESM 入口。原生运行时使用绝对路径，Web 使用内存中的
二进制值。与平台无关的 manifest 工具位于 `react-native-bs-diff-patch/toolkit` ESM 入口。

```ts
import {
  diff,
  patch,
  startDiff,
  startPatch,
  startDiffBytes,
  startPatchBytes,
  diffBytes,
  patchBytes,
  inspectPatch,
  verifyPatch,
  classifyPatchError,
  type BinaryInput,
  type BinaryOperationOptions,
  type PatchMetadata,
  type PatchVerificationResult,
} from 'react-native-bs-diff-patch';
```

## `diff`

```ts
function diff(
  oldFile: string,
  newFile: string,
  patchFile: string
): Promise<number>;
```

在 `patchFile` 创建二进制补丁，仅 Android 与 iOS 可用。

- `oldFile`：已存在的基线文件路径。
- `newFile`：已存在的目标文件路径。
- `patchFile`：必须尚不存在的输出路径。
- 成功时返回 `0`，不会覆盖已有补丁文件。

## `patch`

```ts
function patch(
  oldFile: string,
  outputFile: string,
  patchFile: string
): Promise<number>;
```

在 `outputFile` 还原目标文件，仅 Android 与 iOS 可用。

- `oldFile`：已存在的基线文件路径。
- `outputFile`：必须尚不存在的目标路径。运行时实现将该参数命名为 `newFile`，
  参数位置与行为才是公开约定。
- `patchFile`：已存在且兼容的补丁路径。
- 成功时返回 `0`，不会覆盖已有输出文件。

## 原生 `startDiff` 与 `startPatch`

```ts
interface NativeOperationOptions {
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

interface NativeOperationProgress {
  id: string;
  operation: 'diff' | 'patch';
  phase: 'reading' | 'processing' | 'writing';
  progress: number;
}

interface NativeOperationJob {
  id: string;
  result: Promise<number>;
  cancel(): Promise<void>;
  onProgress(listener: (event: NativeOperationProgress) => void): () => void;
}

function startDiff(
  oldFile: string,
  newFile: string,
  patchFile: string,
  options?: NativeOperationOptions
): NativeOperationJob;

function startPatch(
  oldFile: string,
  outputFile: string,
  patchFile: string,
  options?: NativeOperationOptions
): NativeOperationJob;
```

Android、iOS 需要进度、取消或资源边界时使用 job API。

- `result` 成功时返回 `0`，失败时按原生错误码拒绝。
- `cancel()` 请求协作式取消；取消后的结果以 `ECANCELLED` 拒绝。
- `onProgress()` 只转发当前 job 的事件，并返回取消订阅函数。
- 原生限制在传入时必须是正安全整数。
- job 失败会清理同目录临时输出，且不会覆盖已有目标文件。

## `diffBytes`

```ts
type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

interface BinaryOperationOptions {
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  onProgress?: (event: BinaryOperationProgress) => void;
}

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
```

在 Web Worker 中生成补丁，仅 Web 可用。

- 接受 `ArrayBuffer`、任意 TypedArray、`DataView` 和 `Blob`。
- 零字节二进制输入有效；原生路径 API 另行拒绝空路径字符串。
- 保留调用方缓冲区；`Blob` 与 `File` 通过 WORKERFS 只读挂载，不会先在主线程
  生成完整副本。
- 返回包含 `ENDSLEY/BSDIFF43` 补丁的新 `Uint8Array`。
- 配置上限后，分别用 `maxInputBytes` 检查每个输入，并用 `maxOutputBytes`
  检查生成补丁。

## `patchBytes`

```ts
function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
```

在 Web Worker 中应用兼容补丁，并返回还原后的字节。

- 进入 WebAssembly 核心前会校验补丁头。
- 空基线或空目标缓冲区在补丁格式允许时有效；损坏的补丁输入会被拒绝。
- 保留输入并返回新的 `Uint8Array`。
- 不会修改 `oldData` 或 `patchData`。
- 当补丁头声明的输出超过 `maxOutputBytes` 时，会在分配输出前拒绝。

## `inspectPatch`

```ts
interface PatchInspectionOptions {
  maxInputBytes?: number;
}

interface PatchMetadata {
  format: 'ENDSLEY/BSDIFF43' | 'BSDIFF40' | 'UNKNOWN';
  patchBytes: number;
  headerBytes: number;
  payloadBytes: number;
  declaredTargetBytes: string | null;
  valid: boolean;
  issue?:
    | 'TRUNCATED_HEADER'
    | 'LEGACY_FORMAT'
    | 'INVALID_MAGIC'
    | 'INVALID_TARGET_SIZE';
}

function inspectPatch(
  patchInput: string | BinaryInput,
  options?: PatchInspectionOptions
): Promise<PatchMetadata>;
```

不应用补丁，只读取 24 字节补丁头。Android/iOS 传入补丁路径，Web 传入
`BinaryInput`。

- `declaredTargetBytes` 使用十进制字符串，避免超过 `Number.MAX_SAFE_INTEGER`
  后丢失精度。
- `valid` 只表示结构兼容，不能认证补丁，也不能证明压缩负载完整。
- `BSDIFF40` 会报告为 `LEGACY_FORMAT`，不会被当作
  `ENDSLEY/BSDIFF43` 接受。
- `maxInputBytes` 在读取补丁头前限制原生文件或 Web 二进制输入。

## `verifyPatch`

```ts
interface PatchVerificationResult {
  verified: boolean;
  restoredBytes: number;
  expectedBytes: number;
  patch: PatchMetadata;
}

// Android / iOS 文件路径
function verifyPatch(
  oldFile: string,
  patchFile: string,
  expectedFile: string,
  options?: NativeOperationOptions
): Promise<PatchVerificationResult>;

// Web 二进制值
function verifyPatch(
  oldData: BinaryInput,
  patchData: BinaryInput,
  expectedData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<PatchVerificationResult>;
```

应用补丁，并将还原结果与预期目标逐字节比较。

- 完全一致时返回 `verified: true`；结构有效但还原内容不同时返回
  `verified: false`。
- 补丁结构损坏或不兼容时以 `EPATCH` 拒绝。
- 原生实现使用库管理的临时输出，并在成功、不匹配或失败后清理；不会替换业务文件。
- Web 使用与 `patchBytes` 相同的 Worker/Wasm 路径，并支持 `AbortSignal` 和字节限制。
- 这些跨平台 API 的资源限制错误在所有平台统一为 `ERESOURCE`。

## Web 操作选项

- `signal` 取消当前 Web 操作。带 signal 的调用使用专用 Worker，因此取消不会中断
  其他请求。
- `maxInputBytes` 分别限制每个二进制输入，而不是输入之和。
- `maxOutputBytes` 限制生成补丁或还原输出。
- `onProgress` 接收 C 核心产生的真实 `reading`、`processing` 和 `writing`
  检查点。
- 上限必须是非负安全整数；非法上限以 `EINVAL` 拒绝，超过上限以 `ERESOURCE`
  拒绝。

原生端的二进制 API 接受 options 参数只是为了让共享封装保持源码兼容，随后仍会以
`EUNSUPPORTED` 拒绝。原生路径操作通过 `startDiff`、`startPatch` 获得同类控制。

## Web job

Web 端的 `startDiff()` 与 `startPatch()` 接收二进制输入，并返回
`Promise<Uint8Array>` 结果的 job。`startDiffBytes()` 与 `startPatchBytes()` 是供
跨平台封装明确使用的别名。

```ts
const job = startPatchBytes(oldFile, patchFile, {
  maxOutputBytes: 128 * 1024 * 1024,
});

const unsubscribe = job.onProgress(({ phase, progress }) => {
  renderProgress(phase, progress);
});

try {
  const restored = await job.result;
  // await job.cancel();
} finally {
  unsubscribe();
}
```

取消 job 只会终止它自己的专用 Worker。`result` 会以 `EABORTED` 拒绝；`cancel()` 会在
该 result 到达终态且 Worker/监听器清理完成后才 resolve。完成后再次调用 `cancel()` 是
安全的，不会改变已确定的结果。进度来自 C/WASM 操作，不使用模拟百分比。

## 平台不可用时的行为

所有函数始终导出，以便共享代码保持稳定导入形式。在原生端调用 `diffBytes`、
`patchBytes`、`startDiffBytes` 或 `startPatchBytes` 会以 `EUNSUPPORTED` 拒绝。
Web 端 `diff`、`patch` 不可用，但二进制 `startDiff` 与 `startPatch` 可用。
`inspectPatch` 与 `verifyPatch` 在所有平台可用，但 Android/iOS 必须传文件路径，
Web 必须传二进制值。

SSR 阶段导入 Web 入口不会启动 Worker；在没有浏览器 Worker 的环境调用二进制
API 会以 `EUNSUPPORTED` 拒绝。

## 错误结构

当平台可以分类错误时，拒绝值是带字符串 `code` 的普通 `Error`。

```ts
type PatchError = Error & { code?: string };
```

| 错误码              | 含义                                       |
| ------------------- | ------------------------------------------ |
| `EINVAL`            | 原生空路径/重复路径或输入与选项无效；零字节二进制输入有效。 |
| `ENOENT`            | 原生端所需文件不存在。                     |
| `EEXIST`            | 原生端输出路径已经存在。                   |
| `EUNSUPPORTED`      | 当前平台不支持所选 API。                   |
| `EUNAVAILABLE`      | 原生模块工作队列已经关闭。                 |
| `ECANCELLED`        | 原生 job 被协作式取消。                    |
| `EINPUT_TOO_LARGE`  | 原生输入超过 `maxInputBytes`。             |
| `EOUTPUT_TOO_LARGE` | 原生生成或还原输出超过配置上限。           |
| `EABORTED`          | Web 操作被传入的 signal 取消。             |
| `ERESOURCE`         | 超过跨平台或 Web API 的输入/输出字节上限。 |
| `EDIFF`             | 原生 diff 核心拒绝输入或无法写入补丁。     |
| `EPATCH`            | 原生 patch 核心拒绝损坏补丁或输出失败。    |
| `EWEBASSEMBLY`      | Worker、补丁校验或 WebAssembly 执行失败。  |
| `EUNSPECIFIED`      | 未分类的原生异常。                         |

错误消息仅用于诊断，不是稳定的机器可读约定。恢复策略不同时应根据 `code` 分支。

`classifyPatchError(error)` 会把平台专用错误统一归类为 `ABORTED`、`RESOURCE`、
`INVALID_ARGUMENT`、`INVALID_PATCH`、`VERIFICATION`、`DESTINATION`、
`UNSUPPORTED` 或 `RUNTIME`，同时保留原始 code 与消息。

## 并发与顺序

每个原生平台的 Promise 与 job 操作共用库内部串行队列。取消排队任务会阻止它进入
C 核心；运行中的任务会协作式观察取消。不带 signal 的 Web 调用共用一个模块 Worker、
串行请求队列和已缓存的 WebAssembly 模块；带 signal 的调用使用专用 Worker，确保
取消仅影响当前操作。对大输入仍应设置应用级并发和内存预算。

## 补丁格式

运行时操作只读写 `ENDSLEY/BSDIFF43`，不会自动接受其他 bsdiff 变体。已有
`BSDIFF40` 可以通过 Node CLI 离线转换，并在发布前验证：

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
```
