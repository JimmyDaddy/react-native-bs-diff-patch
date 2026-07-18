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

function diffBytes(
  oldData: BinaryInput,
  newData: BinaryInput
): Promise<Uint8Array>;
```

在 Web Worker 中生成补丁，仅 Web 可用。

- 接受 `ArrayBuffer`、任意 TypedArray、`DataView` 和 `Blob`。
- 会复制输入，不会让调用方缓冲区失效。
- 返回包含 `ENDSLEY/BSDIFF43` 补丁的新 `Uint8Array`。

## `patchBytes`

```ts
function patchBytes(
  oldData: BinaryInput,
  patchData: BinaryInput
): Promise<Uint8Array>;
```

在 Web Worker 中应用兼容补丁，并返回还原后的字节。

- 进入 WebAssembly 核心前会校验补丁头。
- 复制输入并返回新的 `Uint8Array`。
- 不会修改 `oldData` 或 `patchData`。

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
| `EWEBASSEMBLY` | Worker、补丁校验或 WebAssembly 执行失败。 |
| `EUNSPECIFIED` | 未分类的原生异常。                        |

错误消息仅用于诊断，不是稳定的机器可读约定。恢复策略不同时应根据 `code` 分支。

## 并发与顺序

每个原生平台使用库内部的串行队列。每次 Web 调用会创建独立模块 Worker，并在完成后
终止。不要假设不同 Web 调用会按提交顺序结束；对大输入应设置应用级并发限制。

## 补丁格式

四个操作都读写 `ENDSLEY/BSDIFF43` 补丁。以 `BSDIFF40` 开头的其他 bsdiff
变体不能互换。
