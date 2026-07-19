# 平台支持

## 能力矩阵

| 能力                 | Android            | iOS      | React Native Web |
| -------------------- | ------------------ | -------- | ---------------- |
| 文件路径 API         | 支持               | 支持     | 不支持           |
| 二进制数据 API       | 不支持             | 不支持   | 支持             |
| 旧桥接架构           | 支持               | 支持     | 不适用           |
| TurboModule / 新架构 | 支持               | 支持     | 不适用           |
| 后台执行             | 串行 executor      | 串行队列 | 模块 Web Worker  |
| 补丁格式             | `ENDSLEY/BSDIFF43` | 同左     | 同左             |

示例应用持续验证 React Native 0.73.2。Android 源码兼容矩阵会直接使用 React
Native 0.73.11、0.74.7 与 0.86.0 编译新架构集成；常规 Android 构建还会编译
0.73 旧架构。这些是已测试版本，并不承诺所有中间版本或未来版本必然兼容。

## Android

Android 根据 React Native 次版本选择新架构包实现：

- React Native 0.73 使用兼容的 `TurboReactPackage` 源集。
- React Native 0.74 及以上使用 `BaseReactPackage`。
- 旧架构构建使用传统 `ReactPackage` 实现。

原生操作运行在模块自有的单线程 executor 上。项目内置 C 代码通过 CMake 构建，
并由 JNI 调用。

## iOS

iOS autolinking 会为两种架构注册 `BsDiffPatch`。新架构 codegen 通过
`modulesProvider` 映射模块；设置 `RCT_NEW_ARCH_ENABLED` 后，模块返回生成的
TurboModule 实例。

操作在专用串行 dispatch queue 中运行，不占用主队列。

## React Native Web

包提供两种 Web 入口机制：

- `browser` 字段让标准浏览器感知型打包器选择 `web/index.mjs`。
- `src/index.web.ts` 确保 Metro 平台解析器选择 Web API，即使 React Native 对
  `react-native` 包字段具有更高优先级。

浏览器需要支持：

- WebAssembly；
- 模块 Web Worker；
- `ArrayBuffer` 与 TypedArray；
- 使用 `Blob` 输入时的 `Blob.arrayBuffer()`。
- 使用操作取消功能时的 `AbortController`。

Webpack 与 Vite 能识别标准的
`new Worker(new URL(..., import.meta.url), { type: 'module' })` 模式。Metro Web
配置需要在 Web serializer 中保留模块 Worker URL。

Web 入口面向浏览器，不是 Node.js 文件系统适配器；它不会在 Node.js 中提供原生
文件路径 API。

未传 `AbortSignal` 的调用共用模块 Worker 与已初始化的 WebAssembly 模块；带
signal 的调用使用专用 Worker，保证取消只影响当前任务。两种路径都会在各自 Worker
内串行执行，但调用方仍应设置应用级内存预算。

## 服务端渲染

导入 Web 入口不会创建 Worker。在没有 `Worker` 的环境调用 `diffBytes` 或
`patchBytes` 会以 `EUNSUPPORTED` 拒绝。仅在浏览器客户端代码中执行二进制 API。

## 补丁交换

补丁字节可以在 Android、iOS 与 Web 之间传递。文件访问、传输、存储、完整性验证
和最终替换仍由应用负责。安全交换顺序见[生产实践](/docs/zh-CN/recipes/)。
