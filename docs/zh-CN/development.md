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
```

- `test:web` 检查 WebAssembly 往返和补丁 magic。
- `test:web:browser` 在 Chrome 中运行公开 Worker API。
- `test:web:metro` 证明 Metro 选择 `.web` 入口，而不是原生 TurboModule facade。

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

Android CI 构建两种架构模式，并在模拟器矩阵执行新架构设备级往返测试。iOS CI
在受支持的 CocoaPods 矩阵中构建并测试旧架构和新架构配置。

本地示例命令见仓库
[CONTRIBUTING.md](https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/CONTRIBUTING.md)。

## 发布检查清单

1. 执行核心、Web 和站点门禁。
2. 检查 `npm pack --dry-run --ignore-scripts`，确认包含 `web/`。
3. 确认公开文档与导出的 TypeScript 声明一致。
4. 确认中英文指南描述同一套公开行为。
5. 通过仓库 release 命令创建版本和 tag。
6. 对外发布前验证 npm 包和 GitHub release。
