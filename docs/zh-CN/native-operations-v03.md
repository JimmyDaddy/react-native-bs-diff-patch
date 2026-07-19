# 可控制的原生操作

0.3 为 Android 与 iOS 增加了 job API，用于监听进度、协作式取消、限制资源并
原子提交输出。原有 `diff`、`patch` Promise API 保持源码兼容，也不会自动增加
默认限制。

## 公共 API

```ts
import { startPatch } from 'react-native-bs-diff-patch';

const job = startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

const unsubscribe = job.onProgress(({ phase, progress }) => {
  updateProgress({ phase, percent: Math.round(progress * 100) });
});

try {
  await job.result;
} finally {
  unsubscribe();
}

// 可在单独的 UI 操作中调用：
await job.cancel();
```

`startDiff(oldPath, newPath, patchPath, options?)` 返回相同结构。`job.result`
成功时返回 `0`，`job.cancel()` 对调用方可重复执行，`job.onProgress()` 返回取消
订阅函数。

## 资源限制

传入的 `maxInputBytes`、`maxOutputBytes` 必须是正安全整数。限制只作用于当前任务；
库不设置统一默认值，因为安全范围取决于设备级别和宿主应用的内存预算。

- `maxInputBytes` 会在分配操作缓冲区前检查每个原生输入。
- `maxOutputBytes` 会在分配还原缓冲区前检查补丁声明的输出大小。
- 生成补丁时也会在写入压缩结果的过程中检查输出上限。
- 超过限制分别以 `EINPUT_TOO_LARGE`、`EOUTPUT_TOO_LARGE` 拒绝。

## 取消与进度

取消采用协作式机制。共用 C 核心会在读取文件、后缀处理、压缩/解压和输出写入时
检查取消状态。取消后的操作以 `ECANCELLED` 拒绝、删除临时输出，并且不会继续发送
进度事件。

进度按阶段单调递增，并不代表 ETA。事件包含任务 `id`、`diff` 或 `patch` 操作、
`reading`、`processing`、`writing` 阶段，以及 0 到 1 的归一化进度。除阶段切换与
完成事件外，原生端最多每秒发送十次。

## 原子输出

job 操作会独占创建同目录临时文件，完成写入、刷新与校验后再提交到目标路径。目标
文件不能已经存在；失败、命中限制或取消的任务都不会暴露半成品。原有 `diff`、
`patch` 保持既有行为。

## 平台差异

job API 仅用于 Android 与 iOS。React Native Web 应使用二进制 `diffBytes`、
`patchBytes` API，并通过 `AbortSignal` 与字节限制控制任务；Web 调用 `startDiff`
或 `startPatch` 会以 `EUNSUPPORTED` 拒绝。

补丁格式仍是 `ENDSLEY/BSDIFF43`。0.3 改变的是操作控制，不是补丁兼容性。

## 验证范围

仓库从三个层级验证这些能力：

1. 确定性 C 测试覆盖进度、限制、取消、目标文件保护、畸形输入与临时文件清理；
2. Android API 24/31 与 iOS Simulator 通过新架构运行时调用公共 JavaScript job API；
3. React Native 0.73.11/0.74.7 兼容 fixture 编译发布包原生 API，完整 RN 0.86
   示例负责当前版本的构建与运行时门禁。
