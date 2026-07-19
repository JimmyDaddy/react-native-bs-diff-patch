# API 参考

包从同一个入口导出两组平台专用 API。原生运行时使用绝对路径，Web 使用内存中的
二进制值。

```ts
import {
  diff,
  patch,
  diffBytes,
  patchBytes,
  type BinaryInput,
  type BinaryOperationOptions,
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

## `diffBytes`

```ts
type BinaryInput = ArrayBuffer | ArrayBufferView | Blob;

interface BinaryOperationOptions {
  signal?: AbortSignal;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput,
  options?: BinaryOperationOptions
): Promise<Uint8Array>;
```

在 Web Worker 中生成补丁，仅 Web 可用。

- 接受 `ArrayBuffer`、任意 TypedArray、`DataView` 和 `Blob`。
- 会复制输入，不会让调用方缓冲区失效。
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
- 复制输入并返回新的 `Uint8Array`。
- 不会修改 `oldData` 或 `patchData`。
- 当补丁头声明的输出超过 `maxOutputBytes` 时，会在分配输出前拒绝。

## Web 操作选项

- `signal` 取消当前 Web 操作。带 signal 的调用使用专用 Worker，因此取消不会中断
  其他请求。
- `maxInputBytes` 分别限制每个二进制输入，而不是输入之和。
- `maxOutputBytes` 限制生成补丁或还原输出。
- 上限必须是非负安全整数；非法上限以 `EINVAL` 拒绝，超过上限以 `ERESOURCE`
  拒绝。

原生端的二进制 API 接受 options 参数只是为了让共享封装保持源码兼容，随后仍会以
`EUNSUPPORTED` 拒绝。原生资源策略由应用的文件系统与外围流程负责。

## 平台不可用时的行为

四个函数始终导出，以便共享代码保持稳定导入形式。在原生端调用 `diffBytes` 或
`patchBytes`、在 Web 调用 `diff` 或 `patch`，都会以 `EUNSUPPORTED` 拒绝。

SSR 阶段导入 Web 入口不会启动 Worker；在没有浏览器 Worker 的环境调用二进制
API 会以 `EUNSUPPORTED` 拒绝。

## 错误结构

当平台可以分类错误时，拒绝值是带字符串 `code` 的普通 `Error`。

```ts
type PatchError = Error & { code?: string };
```

| 错误码         | 含义                                      |
| -------------- | ----------------------------------------- |
| `EINVAL`       | 输入为空、重复或类型无效。                |
| `ENOENT`       | 原生端所需文件不存在。                    |
| `EEXIST`       | 原生端输出路径已经存在。                  |
| `EUNSUPPORTED` | 当前平台不支持所选 API。                  |
| `EUNAVAILABLE` | 原生模块工作队列已经关闭。                |
| `EABORTED`     | Web 操作被传入的 signal 取消。            |
| `ERESOURCE`    | 超过配置的 Web 输入或输出字节上限。       |
| `EDIFF`        | 原生 diff 核心拒绝输入或无法写入补丁。    |
| `EPATCH`       | 原生 patch 核心拒绝损坏补丁或输出失败。   |
| `EWEBASSEMBLY` | Worker、补丁校验或 WebAssembly 执行失败。 |
| `EUNSPECIFIED` | 未分类的原生异常。                        |

错误消息仅用于诊断，不是稳定的机器可读约定。恢复策略不同时应根据 `code` 分支。

## 并发与顺序

每个原生平台使用库内部的串行队列。不带 signal 的 Web 调用共用一个模块 Worker、
串行请求队列和已缓存的 WebAssembly 模块；带 signal 的调用使用专用 Worker，确保
取消仅影响当前操作。对大输入仍应设置应用级并发和内存预算。

## 补丁格式

四个操作都读写 `ENDSLEY/BSDIFF43` 补丁。以 `BSDIFF40` 开头的其他 bsdiff
变体不能互换。
