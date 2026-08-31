# 独立 Web SDK 的设计与发布

## 目标与边界

新增 `bs-diff-patch-web`，让浏览器、Vite 和桌面 WebView 用户从包根获得字节 API，从 `/toolkit` 获得纯工具层。首版为 `0.5.0`，与已发布的 `react-native-bs-diff-patch@0.5.0` 的功能基线对应；后续两个包可独立升版。

该拆分减少安装体积，明确入口、类型和发布边界，不改变算法、补丁格式、运行速度或 WASM 内存需求。旧 RN 包无需重新发布，保留 RN、Web、Node、CLI 和 Action 的现有入口。此设计不包含下游文件授权、Rust 服务、保存流程或真实 Tauri WebView 验收。

## 源码与产物

| 内容            | 唯一实现                               | 新包产物                                      |
| --------------- | -------------------------------------- | --------------------------------------------- |
| Web 字节 API    | `web/index.mjs`                        | `web/index.mjs`，由根 facade 选择性导出       |
| Worker 生命周期 | `web/worker.browser.mjs` 等            | 原文件逐字节复制                              |
| 浏览器 WASM     | `web/bsdiffpatch.browser.mjs`          | single-file Emscripten 模块，无 Node 文件系统 |
| Web 类型        | `web/index.d.mts`                      | 原文件复制，根 facade 仅公开 Web 类型         |
| 工具层          | `toolkit/index.mjs`、`index.d.ts`      | 原文件逐字节复制，公开 `/toolkit`             |
| Node/CLI        | `node/`、`bin/`、`web/bsdiffpatch.mjs` | 不进入新包，原包保持不变                      |

根 facade 不实现算法，只显式导出可用 Web API。原包的 `diff/patch` 路径 API 在 Web 中返回 `EUNSUPPORTED`；它们以及 `NativeOperation*` 类型不出现在新包根公开接口。`startDiff/startPatch` 的字节任务别名继续可用。

`packages/web/package.json` 是 private 模板，不是新增 Yarn workspace。模板的 `prepack` 在任何生成目录操作之前拒绝直接打包。`yarn build:web:package` 根据白名单生成被 Git 忽略的 `build/web-package/`，去除 private、脚本和开发配置。实际发布只使用这个目录的 tarball；不能从仓库根发布新包。

生成包为 ESM，无 dependencies、peerDependencies、React/RN、原生源码、Node 入口或安装脚本。包内容合约验证精确文件集合、复制内容、公开入口、模块依赖图、运行时与声明的值导出双向一致。没有将旧 RN npm 包作为依赖，也没有复制一套独立维护的 WASM 或 toolkit 源码。

## 消费接口与兼容性

```ts
import { diffBytes, patchBytes, verifyPatch } from 'bs-diff-patch-web';
import { inspectPatchHeader } from 'bs-diff-patch-web/toolkit';

const delta = await diffBytes(base, target, {
  maxOutputBytes: 64 * 1024 * 1024,
});
const header = inspectPatchHeader(delta);
const restored = await patchBytes(base, delta);
const result = await verifyPatch(base, delta, target);
```

`BinaryInput` 接受 Blob、ArrayBuffer 和视图；普通字节调用不转移调用方输入。显式资源预算、AbortSignal、任务取消、进度、Worker 生命周期和错误语义复用现有实现。默认预算不因拆包而收紧；2 GiB 是生成 WASM 的配置上限，不是可保证分配的内存，也不是进程总占用限制。CSP 需要允许同源 Worker 和 WASM；不使用 CDN 或一般 JavaScript `unsafe-eval` 兜底。

Web 生成/应用 ENDSLEY/BSDIFF43；BSDIFF40 只做头部识别并解释不支持。工具层结构校验不读文件、不联网、不验签，canonical payload 和哈希不证明可信来源。完整接入约束见 [Web SDK](./zh-CN/web-sdk.md)。

## 验证策略

共享消费者脚本保留 RN 默认模式，新增独立 Web profile。每次先在空目录正常安装候选 tarball，验证无 RN/React/旧包依赖，然后在 `skipLibCheck: false` 下分别用 NodeNext 与 Bundler 解析类型，验证原生路径 API 不可导入。生产 Vite 输出在真实 Chrome 中运行 Worker/WASM，阻止外网连接并检查 CSP、资源 URL、输入所有权、校验失败、取消、并发和资源上限。

独立的共装 fixture 验证新包与正式 RN 0.5.0 的双向补丁互通，避免旧包掩盖纯 Web fixture 的缺失依赖。另保留正式 registry 0.4.0 的固定 SRI 及 native C 交叉还原测试。原 RN/Node/CLI/Metro、工具层、原生保护、模糊测试和站点检查继续执行。

CI 增加独立 Web 包门禁，并纳入 `Complete CI`。仅包模板、构建/发布工具变更运行 Web/质量/文档门禁；共享 C/Web 源变更继续触发原生兼容性门禁。每周 registry canary 分别保留旧包 Vite/Expo 检查和新包 Web 检查。

## 首版发布与 Trusted Publishing

首版按维护者要求先本地发布真实完整包，然后配置 Trusted Publishing，不发布占位版本、不关闭 2FA、不向 GitHub 保存长期 npm token。

1. 完成评审、全部适用门禁、正常 PR 合并。基于最新 main 的干净提交重新生成、验证并正常 `npm pack`，保存候选 tarball 与 SHA-512 SRI/SHA-256。
2. 用官方 registry 查询确认版本不存在；网络错误、权限错误或内容不符都不能视为“未发布”。用 `PACKAGE_TARBALL` 验证冻结的确切候选，执行 `npm publish <tarball> --access public --registry=https://registry.npmjs.org/` 并完成 npm 身份验证。
3. 从官方 registry 下载并逐字节核验，同步验证签名、纯消费者和补丁互通。首版本地上传不宣称 GitHub Actions provenance。
4. 包存在后，使用 npm 包设置或 `npm trust github bs-diff-patch-web --repo JimmyDaddy/react-native-bs-diff-patch --file web-npm-publish.yml --allow-publish --yes` 配置专属工作流信任，读取设置确认生效。
5. 从发布提交创建独立 `web-v0.5.0` tag 和 GitHub Release。`web-npm-publish.yml` 验证版本、精确 tag 提交及其在 main 中的可达性。首次运行发现同版本已存在时，只在候选 SRI 完全一致的情况下跳过上传，继续 registry 验证；不会补造 provenance。

后续 Web 版本使用 `web-v<version>`，由专属工作流通过 OIDC 发布并生成 provenance。旧 `npm-publish.yml` 仅处理 `v<version>`，不会被 Web release 触发上传旧包。手动重试必须从 main 工作流指定已公开的 Web release；不可移动旧 tag 或覆盖已发布版本。

发布保护脚本对 registry 404、其他 HTTP/网络失败、元数据不符、候选 SRI 不符、下载字节不符及 provenance 策略分别验证。已存在版本若与候选不同即失败，不通过改版本标签或忽略检查掩盖差异。
