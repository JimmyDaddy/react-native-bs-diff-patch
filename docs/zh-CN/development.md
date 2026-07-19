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
```

本地 Clang runtime 支持时，fuzz 门禁使用 libFuzzer、AddressSanitizer 与
UndefinedBehaviorSanitizer；否则运行确定性 sanitizer 语料。兼容 fixture 会使用所选
React Native artifact 直接编译真实 Android 模块源码，不依赖源码文本断言。

可复现的 Web 性能基准命令：

```sh
yarn benchmark:web
BENCHMARK_OUTPUT=/tmp/web-wasm.json yarn benchmark:web
```

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
直接编译新架构源码，并在模拟器矩阵执行新架构设备级往返测试。iOS CI 使用示例
Gemfile 锁定的 CocoaPods 版本构建并测试旧架构和新架构配置。设备测试包含跨平台
golden patch 和损坏补丁拒绝断言。

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
