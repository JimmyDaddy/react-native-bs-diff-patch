# React Native 新架构支持评审

## 范围

- TurboModule Codegen 与 Android/iOS 注册实现。
- `diff`、`patch` 的原生执行线程。
- 示例工程和 CI 对新旧架构的覆盖。

## 总结

当前实现可在 React Native 0.73 与 0.86 新架构下构建，iOS 0.86 运行时调用也可进入原生模块；未发现 P0/P1 阻断问题。确认 3 项 P2 与 1 项 P3，均可执行修复。

## 详细问题

### P2：耗时计算占用 React Native 原生模块调用线程

- 证据：`android/newarch/java/com/jimmydaddy/bsdiffpatch/BsDiffPatchModule.kt` 与 `ios/BsDiffPatch.mm` 在导出方法内直接执行 bsdiff/bspatch。
- 影响：大文件可能长期占用 React Native 的原生模块执行队列，拖慢其他原生调用。
- 建议：Android 使用模块自有单线程执行器；iOS 提供模块专用串行 `methodQueue`。

### P2：CI 未覆盖新架构且缺少有效 JS 测试

- 证据：`example/android/gradle.properties` 设置 `newArchEnabled=false`；Android/iOS CI 未传入新架构开关；`src/__tests__/index.test.tsx` 仅有 `it.todo`。
- 影响：Codegen、自动链接与模块注册回归无法自动发现。
- 建议：CI 增加新旧架构矩阵，并补充 JS 到 TurboModule 的委托测试。

### P2：iOS CI 使用错误的 workspace 与 scheme

- 证据：`.github/workflows/ci.yml` 使用 `ImageMarkerExample`，实际工程为 `BsDiffPatchExample`。
- 影响：iOS 构建与测试任务不能验证当前项目。
- 建议：改为实际 workspace/scheme，并使用可用模拟器目标。

### P3：新架构注册依赖弃用或兼容层 API

- 证据：Android 使用 `TurboReactPackage` 和旧 `ReactModuleInfo` 构造器；iOS `codegenConfig` 缺少 `modulesProvider`。
- 影响：React Native 后续移除旧架构兼容代码时存在构建或注册断裂风险。
- 建议：Android 按 RN 版本选择 `BaseReactPackage`/兼容实现并统一使用非弃用构造器；iOS 增加 `modulesProvider`。

## 已执行验证

- RN 0.73 Android 新架构库目标构建成功。
- RN 0.86 Android 新架构消费者 APK 构建成功。
- RN 0.86 iOS Pod 安装与 Debug/Release 构建成功。
- RN 0.86 iOS 模拟器调用返回预期 `EINVAL`。

## 测试覆盖缺口

- Android 尚无设备级运行时调用测试。
- 仓库质量门禁将在修复完成后重新执行。

## 复核结论（2026-07-18）

整体结论：认可。

- 认可原生工作队列问题，按平台增加专用串行执行设施。
- 认可新架构 CI 与测试覆盖问题，增加新旧架构矩阵和委托测试。
- 认可 iOS CI 目标错误，修正 workspace/scheme。
- 认可弃用注册风险，在保留 RN 0.73 兼容性的前提下使用版本化 Android 源集，并补 iOS 模块映射。

## 修复执行记录（2026-07-18）

| 问题 | 状态 | 执行结果 |
| --- | --- | --- |
| 原生方法同步占用模块线程 | 已完成 | Android 新旧架构共用模块自有单线程执行器，并在模块失效时关闭；iOS 使用模块专用串行队列。 |
| CI 无新架构覆盖、JS 测试为空 | 已完成 | Android 与 iOS 增加新旧架构矩阵；补充 `diff`、`patch` TurboModule 委托测试；同步升级已停止支持的缓存与制品 Actions。 |
| iOS CI workspace/scheme 错误 | 已完成 | 改为 `BsDiffPatchExample.xcworkspace` / `BsDiffPatchExample`，构建使用通用模拟器目标。 |
| 新架构注册依赖弃用/兼容层 API | 已完成 | RN 0.73 保留 `TurboReactPackage` 兼容源集，RN 0.74+ 使用 `BaseReactPackage`；统一非弃用 `ReactModuleInfo` 构造器；iOS 增加 `modulesProvider`。 |

### 修复后验证

- `yarn lint`：通过。
- `yarn typecheck`：通过。
- `yarn test --runInBand`：通过，2 个测试全部成功。
- GitHub Actions YAML 解析：通过。
- RN 0.73 Android：旧架构与新架构库目标均构建成功。
- RN 0.73 iOS：Codegen 成功生成 `RNBsDiffPatchSpec`。
- RN 0.86 Android：新架构消费者 APK 构建成功，使用 `BaseReactPackage`。
- RN 0.86 iOS：Pod 安装、Release 模拟器构建成功；生成的 provider 映射包含 `BsDiffPatch`；模拟器调用进入原生模块并返回预期 `EINVAL`。
- `git diff --check`：通过。

### 剩余非阻塞覆盖缺口

- Android 尚未增加新架构设备级运行时调用断言；当前 CI 已覆盖新架构 Codegen、自动链接和 APK 构建。

## 修复执行记录（2026-07-18，Android 设备级断言）

状态：已完成。

- `example/src/App.tsx` 执行可观测的 `diff`/`patch` 往返，校验原生返回码及重建文件内容，并向 UI 暴露成功或错误状态。
- `example/android/app/src/androidTest/java/com/bsdiffpatchexample/NewArchitectureRuntimeTest.kt` 启动 Release App，先断言 `BuildConfig.IS_NEW_ARCHITECTURE_ENABLED`，再等待并断言往返状态为成功。
- `example/android/app/build.gradle` 配置 Release instrumentation 目标和 AndroidX 测试依赖；Release 包内置 JS bundle，不依赖 Metro。
- `.github/workflows/ci.yml` 在 API 24、25、29、30、31 的 x86_64 模拟器上使用 `-PnewArchEnabled=true` 执行 `connectedReleaseAndroidTest`，并上传独立测试报告。

### 补充验证

- `:app:compileReleaseAndroidTestKotlin -PnewArchEnabled=true`：通过。
- API 34 arm64 模拟器执行 `:app:connectedReleaseAndroidTest -PnewArchEnabled=true`：通过，1 个测试、0 失败；最终回归耗时约 3.6 秒。
- `yarn lint`、`yarn typecheck`、`yarn test --runInBand`：全部通过。
- GitHub Actions YAML 解析与 `git diff --check`：通过。

原“Android 尚无设备级运行时调用测试”的剩余覆盖缺口至此关闭。
