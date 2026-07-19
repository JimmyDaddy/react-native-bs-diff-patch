# 开发与验证

## 前置条件

- Node.js 18 或更高版本。
- 通过仓库检入版本使用 Yarn 3.6.1。
- Android 开发需要 Android Studio / JDK 17。
- iOS 开发需要 Xcode 和 CocoaPods。
- 只有重新生成已检入 WebAssembly bundle 时才需要 Emscripten。

## 安装

```sh
yarn install --immutable
```

根目录是库包，`example/` 是 React Native 消费者应用。

## 核心质量门禁

```sh
yarn prepare
yarn typecheck
yarn lint
yarn test --runInBand
```

## Web 门禁

```sh
yarn test:web
yarn test:web:browser
yarn test:web:metro
yarn test:package
```

- `test:web` 检查 WebAssembly 往返和补丁 magic。
- `test:web:browser` 在 Chrome 中运行公开 Worker API。
- `test:web:metro` 证明 Metro 选择 `.web` 入口，而不是原生 TurboModule facade。
- `test:package` 将真实 tarball 安装到干净消费者，验证 browser、ESM、CommonJS、
  TypeScript 与可选 peer 行为。

## 原生健壮性与兼容性

```sh
FUZZ_RUNS=2000 yarn test:fuzz
scripts/test-rn-android-compatibility.sh 0.73.11 new
scripts/test-rn-android-compatibility.sh 0.74.7 new
scripts/test-rn-android-compatibility.sh 0.86.0 new
scripts/test-rn-ios-compatibility.sh 0.73.11
scripts/test-rn-ios-compatibility.sh 0.74.7
scripts/test-rn-ios-compatibility.sh 0.86.0
```

本地 Clang runtime 支持时，fuzz 门禁使用 libFuzzer、AddressSanitizer 与
UndefinedBehaviorSanitizer；否则运行确定性 sanitizer 语料。兼容 fixture 会使用所选
React Native artifact 直接编译真实 Android 模块源码，不依赖源码文本断言。

可复现的 Web 性能基准命令：

```sh
yarn benchmark:web
BENCHMARK_OUTPUT=/tmp/web-wasm.json yarn benchmark:web
yarn benchmark:native
BENCHMARK_OUTPUT=/tmp/native-core.json yarn benchmark:native
```

发布包 canary 会直接从 npm 安装，并有意使用当前 Vite 与 Expo 工具链；它们是定时
CI，不是发版门禁。可用 `yarn test:registry:vite` 和 `yarn test:registry:expo`
手动执行，并通过 `PACKAGE_SPEC` 验证指定 tag 或 tarball。

## 依赖安全

发布包没有 npm runtime dependency；React 与 React Native 都是可选 peer。
Dependabot 会把常规 npm、Ruby 与 Actions 更新分组，控制评审数量；对于 API 兼容
的叶子依赖，锁文件会直接固定到已修复版本。

旧版开发工具链目前仍有三类仅开发期使用、不能安全强制升级的传递依赖：
`fast-xml-parser` 的修复版本超出 CLI 12 的 major 范围，`tar` 的修复版本超出父依赖
的 major 范围，而 `ip` 的一个告警尚无已修复版本。它们应继续保留在 GitHub alerts
中；待 0.73 示例与 Jest 工具链退役，或父依赖提供兼容升级后移除。

## 站点与文档

```sh
yarn site:build
yarn site:test
yarn site:test:browser
```

静态输出写入 `site-dist/`，由 GitHub Pages 工作流部署。构建脚本把 `docs/` 下的
Markdown 渲染到站点。英文页位于 `docs/` 根部，中文镜像位于 `docs/zh-CN/`；
公开行为或 API 改动时应同步两种语言。

## 重新构建 WebAssembly

修改 `cpp/` 后，激活 Emscripten 工具链并运行：

```sh
yarn build:web
yarn test:web
yarn test:web:browser
```

将重新生成的 `web/bsdiffpatch.mjs` 与 C 源码改动一起提交。

## 原生验证

Android CI 构建两种架构模式，使用 React Native 0.73.11、0.74.7 与 0.86.0
直接编译新架构源码，并在模拟器矩阵执行新架构设备级往返测试。iOS CI 也针对三
个 React Native 版本编译 Pod，再使用示例 Gemfile 锁定的 CocoaPods 版本测试旧
架构和新架构。模拟器除跨平台 golden patch 与损坏补丁拒绝外，还会断言实际启用
的架构模式。

本地示例命令见仓库
[CONTRIBUTING.md](https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/CONTRIBUTING.md)。

## 发布检查清单

1. 执行核心、Web 和站点门禁。
2. 运行 `yarn test:package`，并检查 `npm pack --dry-run --ignore-scripts`。
3. 确认公开文档与导出的 TypeScript 声明一致。
4. 确认中英文指南描述同一套公开行为。
5. 运行 `yarn release` 创建版本、tag 和 GitHub Release；该命令不直接发布 npm。
6. GitHub Release 发布后会触发 `npm-publish.yml`。工作流校验 tag 与
   `package.json` 版本一致，执行发布门禁，通过 npm Trusted Publishing 发布，
   并验证 provenance 证明。
7. 对外发布前验证 npm 包和 GitHub Release。

npm 包的 Trusted Publisher 已按以下值配置完成：

- Provider：GitHub Actions。
- Organization or user：`JimmyDaddy`。
- Repository：`react-native-bs-diff-patch`。
- Workflow filename：`npm-publish.yml`。
- Environment：留空。

正常发布无需再修改 npm 侧配置，工作流也不使用长期 npm token。
