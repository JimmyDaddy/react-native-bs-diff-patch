# 0.3 原生操作路线图

0.2 已完成后台执行、跨平台确定性补丁、畸形输入清理，以及浏览器端的取消和资源
限制。0.3 会在不改变现有 `diff`、`patch` 签名的前提下，为原生端补齐同类生产控制。

本文是实现约定。公开命名在 0.3 beta 前仍可调整，但以下行为和错误模型是验收条件。

## 公开接口形态

现有 Promise API 保持源码兼容；需要限制、取消或进度的调用方使用新增 job API：

```ts
type NativeOperationOptions = {
  maxInputBytes?: number;
  maxOutputBytes?: number;
};

type NativeOperationProgress = {
  id: string;
  operation: 'diff' | 'patch';
  phase: 'reading' | 'processing' | 'writing';
  progress: number; // 从 0 到 1，单调递增
};

const job = startPatch(oldFile, newFile, patchFile, options);
const unsubscribe = job.onProgress((event) => updateUi(event.progress));
await job.cancel();
await job.result;
unsubscribe();
```

`diff` 和 `patch` 继续使用同一个串行原生 worker，且不会隐式增加大小上限，因此升级
不会让原本成功的操作突然被拒绝。

## 资源限制

- JavaScript 与原生端都要把每个限制校验为正的安全整数。
- 分配操作缓冲区前检查输入文件大小。
- 分配还原输出前检查补丁头声明的长度。
- 生成输出时持续执行限制，而不是完成后才检查。
- 超限分别拒绝为 `EINPUT_TOO_LARGE` 或 `EOUTPUT_TOO_LARGE`，原生错误元数据包含
  配置上限和实际字节数。

限制按操作设置。库不提供通用默认值，因为安全值取决于设备档位和宿主应用的内存预算。

## 取消与进度

取消采用协作式检查。共用 C 核心接收回调上下文，并在文件读取、后缀处理、压缩与
解压、输出写入阶段检查取消状态。取消后以 `ECANCELLED` 拒绝，且不再发送进度事件。

进度按阶段计算并单调递增，但不是 ETA：后缀排序和压缩耗时受数据影响。原生端把
事件频率限制为每秒最多十次，避免频繁跨越 React Native 边界。

## 原子输出

0.2 已保证失败时删除本次创建的输出。0.3 的 job 操作进一步使用原子提交：

1. 在目标文件同目录以排他模式创建唯一临时文件；
2. 写入、flush、关闭并验证结果；
3. 将临时文件 rename 为目标路径；
4. 出错或取消时删除临时文件。

目标文件必须不存在；rename 必须发生在同一文件系统，库不会静默退化成复制。

## 交付顺序

1. 为 C stream 增加可取消、可限制的回调和确定性 C 测试。
2. 增加 Android/iOS job registry、事件发送与清理测试。
3. 暴露 TypeScript job facade，同时保持 `diff`、`patch` 不变。
4. 在 Android API 24 与 iOS 模拟器执行取消和资源限制运行时测试。
5. 发布 0.3 beta，验证 registry 消费者，再发布稳定版且不改变补丁字节。

补丁格式仍是 `ENDSLEY/BSDIFF43`；0.3 改变的是操作控制，不是兼容性。
