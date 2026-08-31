# 可验证增量发布工具链

这个包既可以作为客户端运行时，也可以作为发布端 Node 工具，或者同时承担两种角色。
共享的 manifest 与 bundle schema 将补丁生成、CDN 选择和验证还原连接起来，但不会
接管传输系统或私钥。

## Node CLI

可以在发布工作区安装包，也可以直接通过 `npx` 运行：

```sh
npx react-native-bs-diff-patch diff old.bin new.bin -o update.patch
npx react-native-bs-diff-patch inspect update.patch --json
npx react-native-bs-diff-patch verify old.bin update.patch new.bin
npx react-native-bs-diff-patch manifest \
  old.bin update.patch new.bin -o patch-manifest.json
```

CLI 不会覆盖已有输出。Node 复用 Web 发布的同一份 WebAssembly 核心，并通过
NODEFS 直接挂载宿主路径，避免在 JavaScript 中再产生一份完整文件副本。diff
生成仍会在 C/WASM 核心内为完整输入建立索引；patch 应用与验证走有界流式文件路径。

## 可验证补丁 manifest

环境无关的 toolkit 入口提供 `createPatchManifest()` 与
`validatePatchManifest()`：

```ts
import {
  canonicalJson,
  createPatchManifest,
  signingPayload,
} from 'react-native-bs-diff-patch/toolkit';

const manifest = createPatchManifest({
  baseline: { bytes: 1000, sha256: baselineSha256 },
  patch: { bytes: 120, sha256: patchSha256, url: 'update.patch' },
  target: { bytes: 1100, sha256: targetSha256, url: 'app.bin' },
});

const bytesToSign = new TextEncoder().encode(signingPayload(manifest));
const canonical = canonicalJson(manifest);
```

库负责 canonical JSON、SHA-256 描述校验和 detached-signature 元数据，但不会
加载、保存或管理私钥。请通过现有发布签名系统认证 canonical manifest。

## Node 验证还原

Node 入口会先验证基线与补丁，应用后再验证目标；只有全部一致才保留输出：

```ts
import {
  createFilePatchManifest,
  restoreVerified,
} from 'react-native-bs-diff-patch/node';

const manifest = await createFilePatchManifest(
  'old.bin',
  'update.patch',
  'new.bin'
);

await restoreVerified('old.bin', 'update.patch', 'restored.bin', manifest);
```

基线、补丁或目标不匹配时会以验证错误拒绝，并删除请求的输出。

## 多基线 bundle

从基线目录内的每个普通文件生成到同一目标的发布计划：

```sh
npx react-native-bs-diff-patch bundle \
  --from releases/ \
  --to dist/app.bin \
  --out dist/update-bundle \
  --max-ratio 0.85 \
  --release-id v1.5.0
```

输出内容包括：

- 完整目标文件回退；
- 每个高收益基线对应的 `ENDSLEY/BSDIFF43` 补丁；
- 面向人工和 CDN 的 `bundle-manifest.json`；
- 面向签名的 `bundle-manifest.canonical.json`；
- 显示补丁或完整文件选择结果的决策报告。

运行时通过 `selectPatch()` 匹配可信基线 SHA-256，并可附加补丁字节数或比例预算。
基线不存在或补丁不划算时会明确选择完整文件。

## GitHub Action

仓库提供了一个零依赖的单基线 Action：

```yaml
- uses: JimmyDaddy/react-native-bs-diff-patch@v0.5.0
  id: delta
  with:
    old-file: releases/v1.bin
    new-file: dist/app.bin
    patch-file: dist/update.patch
    manifest-file: dist/patch-manifest.json
    max-patch-ratio: '0.85'

- run: echo "strategy=${{ steps.delta.outputs.strategy }}"
```

多基线发布使用 CLI 的 `bundle` 命令。Action 会输出补丁大小、目标大小、比例、节省量
以及最终 `patch` 或 `full` 策略。

## BSDIFF40 迁移

运行时继续只接受 `ENDSLEY/BSDIFF43`。已有 `BSDIFF40` 可以在不读取基线文件的
情况下离线转换：

```sh
npx react-native-bs-diff-patch convert legacy.patch -o compatible.patch
npx react-native-bs-diff-patch inspect compatible.patch
```

转换器会校验 BSDIFF40 的三个压缩块，并改写为交错的 BSDIFF43 数据流；损坏输入或
已有输出都会被拒绝。发布前仍应使用已知基线和目标验证转换后的补丁。

## 浏览器 Release Planner

[发布规划器](https://bs-dff-patch.corerobin.com/zh-CN/planner/) 可以完全在浏览器
本地生成多基线矩阵与相同的 bundle manifest，适合评估和调试。生产产物应通过 CLI
在 CI 中复现；规划器不会上传用户选择的文件。
