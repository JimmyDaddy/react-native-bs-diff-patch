# 常见问题与排障

先看错误 `code`，再确认运行时和输入模型：

| 现象                          | 首要检查                        |
| ----------------------------- | ------------------------------- |
| 找不到原生模块                | 重新构建并安装原生应用          |
| `ENOENT`、`EEXIST`、`EINVAL`  | 在原生任务开始前检查路径状态    |
| `EUNSUPPORTED`                | 确认选择了当前平台对应的 API 族 |
| `EABORTED`、`ERESOURCE`       | 检查 Web 取消与配置的字节上限   |
| `EDIFF`、`EPATCH`             | 检查原生 I/O 与补丁完整性       |
| Worker 或 `EWEBASSEMBLY` 失败 | 检查 Web 资源、CSP 和补丁 magic |
| 内存占用过高                  | 设置输入大小和并发限制          |

## `TurboModuleRegistry.getEnforcing(...): 'BsDiffPatch' could not be found`

安装包后重新构建原生应用。Metro 刷新无法向已经安装的二进制添加原生模块。

- iOS：运行 `npx pod-install`，必要时清理 Xcode 构建并重新安装应用。
- Android：停止应用，必要时清理旧 Gradle 输出并重新构建。
- 确认 JavaScript 包和原生应用来自同一份依赖状态。

## `ENOENT`

所需文件路径不存在。请确认：

- 路径是绝对路径，并位于应用可访问存储中；
- `diff` 开始前旧文件和新文件已经存在；
- `patch` 开始前旧文件和补丁已经存在；
- 异步写入已经完成。

## `EEXIST`

原生目标已经存在。本库不会静默覆盖补丁或还原文件。清理应用拥有的临时输出，或
使用新的唯一路径。

## `EINVAL`

路径可能为空或重复，Web 二进制输入也可能不是可接受类型。旧文件、目标输出和
补丁路径必须互不相同。

## Web 上的 `EUNSUPPORTED`

路径版 `diff` 和 `patch` 仅原生可用。React Native Web 应使用 `diffBytes` 和
`patchBytes`。如果错误指出需要 Web Worker，请在浏览器客户端而不是 SSR 中调用。

## `EABORTED` 或 `ERESOURCE`

`EABORTED` 表示传给 Web 操作的 `AbortSignal` 在开始前或专用 Worker 运行时被取消。
`ERESOURCE` 表示输入、生成补丁或补丁声明的还原输出超过配置的字节上限。二者是预期
控制流错误，并不表示 WebAssembly 损坏。

## Worker 加载失败

确认打包器输出了模块 Worker 资源，并且服务器将 `.mjs` 作为 JavaScript 提供。
严格 CSP 需要允许同源 Worker 和 WebAssembly 执行。

在浏览器网络面板中确认 `worker.mjs`、`operations.mjs` 和 `bsdiffpatch.mjs`
返回成功状态，而不是应用 HTML fallback。

## `EPATCH`、`EWEBASSEMBLY` 或补丁损坏

检查补丁前 16 字节。受支持补丁以 `ENDSLEY/BSDIFF43` 开头。截断补丁、
`BSDIFF40` 补丁或其他二进制数据都会被拒绝。

原生端损坏补丁使用 `EPATCH`，补丁生成失败使用 `EDIFF`。Web 校验与 C 核心失败使用
`EWEBASSEMBLY`，除非资源上限提供了更具体的 `ERESOURCE`。原生调用失败时会删除该
操作拥有的残留输出。

## 内存占用过高

算法和适配器处理完整内存缓冲区。调用前添加大小限制，不要接受任意大的不可信文件。
Web 虽在主线程外执行，仍会消耗当前标签页内存。

不带 signal 的 Web 操作在共享 Worker 中排队；带 signal 的操作使用专用 Worker，
以实现隔离取消。对重复用户操作进行防抖；大任务可能重叠时设置应用级预算。

## 还原结果不一致

确认补丁由当前使用的精确基线字节生成。补丁应保持为不透明二进制数据，避免字符串
或 JSON 转换。应用前验证补丁摘要，替换业务数据前验证目标摘要。

## 提交诊断信息

创建 issue 时请提供：

- React Native 和本库版本；
- 平台、架构模式和打包器；
- 被拒绝错误的 `code` 与消息；
- 不包含敏感数据的最小输入大小和路径状态；
- 问题能否在示例应用或在线 Playground 复现。
