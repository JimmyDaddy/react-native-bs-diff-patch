# 架构与补丁格式

库保留一套补丁实现，并通过三种运行时适配器暴露。

## 执行路径

```text
React Native JavaScript
  -> 强类型公开 API
  -> TurboModule 或旧桥接
  -> 平台自有串行工作队列
  -> JNI / Objective-C++
  -> 共用 bsdiff + bzip2 C 源码

React Native Web
  -> 强类型公开 API
  -> 共享或取消任务专用的模块 Web Worker
  -> Emscripten MEMFS
  -> 由同一套 bsdiff + bzip2 C 源码编译的 WebAssembly
```

Worker 边界让高开销二进制计算离开 JavaScript / UI 线程，但不会消除算法成本。
调用方仍需设置符合产品场景的输入大小和时间限制。

未传 `AbortSignal` 的 Web 调用复用一个 Worker 和已缓存的 Emscripten 模块，避免
重复初始化 Worker 与 WebAssembly。带 signal 的调用使用专用 Worker，取消 signal
只会终止该 Worker。每个 Worker 在自己的队列内串行执行，并在每次操作后删除
MEMFS 临时文件。

## 补丁线格式

补丁以 24 字节头开始：

| 字节     | 内容                                 |
| -------- | ------------------------------------ |
| `0..15`  | ASCII magic `ENDSLEY/BSDIFF43`       |
| `16..23` | 该格式字节序下的有符号 64 位目标大小 |
| `24..`   | bzip2 压缩的控制、差分和附加数据     |

Web 适配器进入 C patch 函数前会校验头和签名。原生与 Web 使用同一份已检入的
bsdiff 和 bzip2 源码，从而保持跨平台兼容。

格式能标识补丁实现，但不标识预期基线或发布版本。分发补丁时，应用应在可信清单中
携带基线和目标摘要。

## WebAssembly 打包

`scripts/build-web-wasm.sh` 使用 Emscripten 生成：

- ES module 工厂；
- 单文件内嵌 WebAssembly payload；
- 可增长内存；
- MEMFS 以及 `FS` / `ccall` 运行时方法；
- 导出的 `bsDiffFile` 和 `bsPatchFile` 函数。

生成的 `web/bsdiffpatch.mjs` 随 npm 包发布，消费者无需安装 Emscripten。

## 兼容性验证

仓库内 golden fixture 证明 Web 实现生成的确定性补丁字节可被 Android 与 iOS
消费。设备运行时测试还会应用 Web golden patch，并验证截断补丁会被拒绝且不会
留下残缺输出。C patch 核心具有 sanitizer 支持的畸形输入 fuzz 覆盖，非法数据不会
终止宿主进程。

## Web 参考基准

`yarn benchmark:web` 使用每 4 KiB 修改一个字节的确定性输入，并逐字节验证还原
结果。在 Apple M3 Pro、Node 26.5.0 上，仓库记录的 2026-07-19 基准如下：

| 输入   | Diff        | Patch    | 补丁字节数 |
| ------ | ----------- | -------- | ---------- |
| 1 MiB  | 158.5 ms    | 7.7 ms   | 110        |
| 10 MiB | 4,243.6 ms  | 57.5 ms  | 118        |
| 50 MiB | 30,697.5 ms | 285.2 ms | 203        |

这些数据是可复现的开发基线，不是设备或浏览器性能保证。输入相似度、CPU、浏览器、
内存压力和工具链版本都会显著影响结果。完整机器可读记录位于
[`benchmarks/web-wasm.json`](https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/benchmarks/web-wasm.json)。

## 原生核心参考基准

`yarn benchmark:native` 会编译 Android 与 iOS 嵌入的同一套 C 源码，每个尺寸使用
独立进程，验证还原文件，并记录峰值常驻内存。在同一台 Apple M3 Pro 上，仓库基准为：

| 输入   | Diff        | Patch    | 补丁字节数 | 峰值 RSS  |
| ------ | ----------- | -------- | ---------- | --------- |
| 1 MiB  | 149.7 ms    | 4.8 ms   | 110        | 21.1 MiB  |
| 10 MiB | 4,103.3 ms  | 34.3 ms  | 118        | 193.6 MiB |
| 50 MiB | 31,852.3 ms | 199.7 ms | 203        | 960.4 MiB |

这组数据隔离了 React Native 调度与文件系统封装，并不是 Android 或 iOS 设备跑分。
定时 Linux/macOS job 会把报告作为 CI artifact 上传，便于在同类 runner 上比较回归。
检入记录位于
[`benchmarks/native-core.json`](https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/benchmarks/native-core.json)。

## 内存模型

原生操作会把旧文件与目标文件读入进程内存。Web 调用先复制输入再传给 Worker，
之后从 MEMFS 复制结果，因此峰值内存可能达到输入或输出大小的数倍。在这组高度相似
的 50 MiB fixture 中，原生参考峰值约为输入的十九倍，主要来自后缀数组和同时存在的
文件缓冲区。

对于大更新，应在调用前执行应用级大小限制。完整文件无法安全放入内存时，应考虑
服务端或流式更新策略。

## 职责边界

库负责补丁计算和平台调度；应用负责：

- 文件选择、存储权限和临时文件清理；
- 补丁传输与缓存策略；
- 来源认证与密码学完整性校验；
- 并发、大小和时间限制；
- 还原结果验证和原子替换。

这些职责保留在补丁引擎外，便于应用复用已有文件系统和发布信任模型。

## 兼容规则

补丁兼容性由 magic 与实现共同决定，而不只是通用名称“bsdiff”。来自其他包的
`BSDIFF40` 补丁不是受支持输入。跨 Android、iOS 与 Web 时，应使用本库成对生成
和应用补丁。
