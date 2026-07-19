# 生产实践

以下模式覆盖补丁引擎之外仍由应用负责的部分：唯一路径、清理、完整性和平台边界。

## 按错误码处理

错误消息只用于诊断，恢复决策应使用 `code`。

```ts
type PatchError = Error & { code?: string };

export function isPatchError(error: unknown): error is PatchError {
  return error instanceof Error;
}

try {
  await patch(oldPath, outputPath, patchPath);
} catch (error) {
  if (isPatchError(error) && error.code === 'EEXIST') {
    // 清理已知的临时输出，或换一个唯一输出路径重试。
  } else if (isPatchError(error) && error.code === 'ENOENT') {
    // 重新下载或定位所需的旧文件或补丁。
  } else {
    throw error;
  }
}
```

不要仅因为收到 `EEXIST` 就删除用户拥有的目标文件。只清理应用自己创建的临时路径。

## 跨运行时交换补丁

所有平台共用 `ENDSLEY/BSDIFF43`，因此合法流程可以跨越运行时：

1. 在 Android 或 iOS 用 `diff`，或在 Web 用 `diffBytes` 生成补丁。
2. 将补丁作为不透明二进制数据存储或传输，不进行文本转换。
3. 向目标运行时提供该补丁所对应的精确基线文件。
4. 使用目标运行时对应的 API 族应用补丁。
5. 用可信目标哈希验证还原结果。

基线身份与补丁本身同样重要。将有效补丁应用到错误基线不是受支持的更新流程。

## 认证远程补丁

只有传输安全并不能证明补丁属于预期版本。建议分发带签名的清单，至少包含：

- 基线版本或基线摘要；
- 补丁摘要和字节长度；
- 目标摘要和字节长度；
- 补丁格式标识；
- 发布标识和签名元数据。

应用补丁前验证清单和下载内容，替换业务数据前验证还原文件。签名与哈希保持在库外，
便于应用沿用已有信任模型。

## 原生端原子替换

将还原文件写到与最终目标相同存储区域中的唯一路径。完整性验证通过后，在文件系统层
支持的情况下，通过原子重命名或替换完成切换。不要让 `patch` 直接覆盖活动文件；
其输出路径必须尚未使用。

## 限制资源使用

算法处理完整缓冲区，峰值内存可能是输入或输出的数倍。开始操作前应：

- 拒绝超过产品验证上限的输入；
- 确认原生端临时输出所需的本地空间；
- 防止用户操作触发无限并发；
- 使用 `startDiff`/`startPatch` 限制原生字节数并提供取消入口；
- Web 操作需要取消时传入 `AbortSignal`；
- 将超大更新的生成工作放到受控后端基础设施。

原生调用共用库内部串行队列。不带 signal 的 Web 调用复用共享 Worker 与
WebAssembly 实例；带 signal 的调用使用专用 Worker，因此可以独立终止。应用仍应
显式限制 Web 总并发和内存。

```ts
const controller = new AbortController();
const options = {
  signal: controller.signal,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
};

try {
  const patchData = await diffBytes(oldData, newData, options);
  const restoredData = await patchBytes(oldData, patchData, options);
} catch (error) {
  if (isPatchError(error) && error.code === 'EABORTED') return;
  if (isPatchError(error) && error.code === 'ERESOURCE') {
    // 展示产品自己的大小限制说明。
    return;
  }
  throw error;
}
```

原生端对应流程使用 job：

```ts
const job = startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});
const unsubscribe = job.onProgress(renderProgress);

try {
  await job.result;
} catch (error) {
  if (isPatchError(error) && error.code === 'ECANCELLED') return;
  if (
    isPatchError(error) &&
    ['EINPUT_TOO_LARGE', 'EOUTPUT_TOO_LARGE'].includes(error.code || '')
  ) {
    // 展示原生端大小限制说明。
    return;
  }
  throw error;
} finally {
  unsubscribe();
}
```

## 下载 Web 补丁

创建对象 URL、触发下载，并在使用后释放 URL：

```ts
const patchData = await diffBytes(oldFile, newFile);
const url = URL.createObjectURL(new Blob([patchData]));
const link = Object.assign(document.createElement('a'), {
  href: url,
  download: 'release.patch',
});
link.click();
URL.revokeObjectURL(url);
```

上传或存储时始终保持二进制字节。让任意补丁字节经过 UTF-8 字符串会破坏数据。
