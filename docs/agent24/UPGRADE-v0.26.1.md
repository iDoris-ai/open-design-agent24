# ODX-1：Agent24 补丁迁到 Open Design v0.26.1

分支 `agent24/v0.26.1`，底是 tag `open-design-v0.26.1`（`ac476788b7`）。
旧集成停在 `34bc2ba810`（`open-design-v0.22.2` 之上 23 个提交）。
这一轮只带回 Agent24 运行时、headless 启动器和 `resourceSafeBase`。
首页和 `app.brand` 用上游 v0.26.1。没有 push。

Agent24 要钉的版本是 `apps/packaged/package.json` 里的 `0.26.1`。
仓库根 `package.json` 仍是 `0.25.1`，不要拿根版本当 pin。
SHA 用包含本文件的那次提交（`git rev-parse HEAD`）。
代码提交停在 `f37d5fb7d4`，本文件在它上面。

## 补丁处理

`open-design-v0.22.2..34bc2ba810` 共 23 个提交。
原样搬入 12，改写后搬入 2，放弃 9。
搬入用 `git cherry-pick -x`，原作者保留。

| 原提交 | 新提交 | 处理 | 理由 |
|---|---|---|---|
| `17c4e86f21` | — | 放弃 | `docs/agent24-baseline.md` 记录的是 v0.22.2。ODX-1 不带回，由本文件替代 |
| `227aa45d01` | `44fe4d409a` | 原样搬入 | `agent24` ACP runtime（`buildArgs: ['acp']`） |
| `ff27c8f24d` | `9682d18448` | 原样搬入 | 持久化 ACP 文本产物。`server.ts` 自动合并，补丁正文与原提交一致 |
| `cee4bcd915` | `7427a1f2fb` | 原样搬入 | 重复 ACP 产物改为更新。自动合并，正文一致 |
| `c696ea2992` | `e8ef761183` | 原样搬入 | 新增 `agent24-headless`。`package.json` 只加 export |
| `deff6636a7` | `afff16c48c` | 原样搬入 | 启动器拷进 prebundled。mac / linux / win / resources 自动合并，正文一致 |
| `c503b6aec9` | `2caba9071e` | 改写后搬入 | `tools/pack/src/win/app.ts` 冲突，见下 |
| `46a35a4393` | — | 放弃 | merge PR #3，内容在子提交里 |
| `002126b547` | `a1dd3f2c41` | 原样搬入 | 长可见产物不截断 |
| `83ce740f4a` | `05799ddad6` | 原样搬入 | analytics provider 枚举加入 `agent24`。自动合并，正文一致 |
| `e3c37fc14f` | — | 放弃 | 把集成分支 merge 进功能分支 |
| `e4be3d5d8c` | — | 放弃 | merge PR #2 |
| `fb20aa2bb8` | `eeccd0370d` | 改写后搬入 | `sidecars.ts` 冲突，见下。其余文件正文与原提交一致 |
| `327de2887f` | — | 放弃 | merge PR #5 |
| `c49ba6a301` | — | 放弃 | 首页大 logo / `IDorisDesignLogo`。上游 Home 已换成 `RotatingTitleWord` |
| `88ec4b3885` | — | 放弃 | 标题、加载文案、17 个 locale 的 `app.brand`。留给后面的文案覆盖层 |
| `f84ff89656` | — | 放弃 | merge PR #6，里面是品牌提交 |
| `813322cab2` | `73b200b719` | 原样搬入 | headless 协议 v2，显式 `resourceSafeBase` |
| `3d2df0991f` | `6e990e16a2` | 原样搬入 | resourceSafeBase 复审 |
| `9961f2f7cc` | `dea1ca8862` | 原样搬入 | 复审修复 |
| `c192732b2a` | `b360a08527` | 原样搬入 | 复审修复 |
| `ed60d6d237` | `f37d5fb7d4` | 原样搬入 | TOCTOU 快照补齐 |
| `34bc2ba810` | — | 放弃 | merge PR #7 |

相对 tag 的结果是 22 个文件，+1939 / −23。
`HomeHero.tsx`、`IDorisDesignLogo.tsx`、`home-logo-assets.test.ts`、locale 都没有改。

## 冲突

计划点名的 4 个文件里，真正打出冲突标记的是 2 个。
另外 2 个因为品牌提交整段放弃，没有合。

### `tools/pack/src/win/app.ts`（`c503b6aec9`）

上游在 `runElectronRebuild` 之后调用 `finalizeRuntimeManifest(appRoot)`，再调用只有一个参数的 `validateWinPackagedAppRuntime(appRoot)`。
我们的补丁给校验函数加了 `usePrebundle`，用来确认 prebundled 里的 `agent24-headless.mjs` / `.cjs`。

留下两段：

```ts
await finalizeRuntimeManifest(appRoot);
const nativeValidationError = await validateWinPackagedAppRuntime(appRoot, usePrebundle);
```

`finalizeRuntimeManifest` 只把 `package.json` 里的 `file:` 依赖改成已安装版本，不删 prebundled 文件。
`copyAgent24HeadlessLauncher` 在 `buildPrebundledStandaloneRuntime` 开头，早于 npm install、electron rebuild 和 finalize。
mac 的 `tools/pack/src/mac/app.ts` 自动合并后是同一顺序：先拷启动器，组装末尾再 `finalizeRuntimeManifest`。
`linux.ts` 把启动器拷进 `prebundled/`。上游的 linux 打包路径本来就不调用 `finalizeRuntimeManifest`。

缓存 `schemaVersion` 留在上游已经在用的 `7`。
原补丁是把 6 改成 7；三方合并时两边都是 7。
没有再抬到 8。`invalidate()` 会用带 `usePrebundle` 的校验看启动器在不在，缺了就重建。
这次没有拿一份 v0.26.1 的 Windows 打包缓存做实测。

### `apps/packaged/src/sidecars.ts`（`fb20aa2bb8`）

同一处环境变量组装：我们要传入 `resourceSafeBase`，上游要写入 `OD_APP_SESSION_ID` / `OD_LAUNCH_ATTEMPT_ID`。

留下两段：

```ts
...createPackagedDaemonManagedPathEnv(paths, options.resourceSafeBase),
...(options.launchContext
  ? { OD_APP_SESSION_ID: options.launchContext.app_session_id, OD_LAUNCH_ATTEMPT_ID: options.launchContext.launch_attempt_id }
  : {}),
```

上游后加的分享 viewer 环境变量还在这之后。
`OD_PACKAGED_RESOURCE_SAFE_BASE` 的类型、`startPackagedSidecars` 的透传，和原提交一致。

### 没有冲突标记、但核对过的自动合并

`server.ts`、`auth.ts`、analytics 枚举、`package.json`、mac/linux 打包和 resources 测试的补丁正文，和原提交逐行一致（只差行号）。
`persistVisibleTextArtifacts` 只在 `agent24` 上为 true，插在已有的 plain-stream 落盘后面。
plain-stream 那条调用没有传 `overwriteMatchingIdentifier`，仍是旧的只创建行为。
`OD_PACKAGED_RESOURCE_SAFE_BASE` 未设置时，信任根表达式退回 `OD_INSTALLATION_DIR`。

## 构建

`pnpm install --frozen-lockfile` 成功。postinstall 里的 `tsc` 产出 `apps/daemon/dist/cli.js`。

源码 checkout（`creative-serve-web.ts` 要的两个文件）：

- `pnpm --filter @open-design/daemon run build` → `apps/daemon/dist/cli.js`
- `env -u OD_WEB_OUTPUT_MODE pnpm --filter @open-design/web run build` → `apps/web/out/index.html`

两条都跑过，产物在。web 是默认静态导出，不是 standalone。

`apps/packaged` 的 `tsc` 依赖 `@open-design/desktop` 的类型。
先 `pnpm --filter @open-design/desktop run build`，再 `pnpm --filter @open-design/packaged run build`，exit 0。
esbuild 写出 `apps/packaged/dist/agent24-headless.mjs` 和 `agent24-headless.cjs`。
这和 linux 资源脚本里的 `pnpm --filter @open-design/packaged^... run build` 一样，会先构建 packaged 的依赖。

linux 资源脚本里的命令没有改：

```
OD_WEB_OUTPUT_MODE=standalone pnpm --filter @open-design/packaged^... --workspace-concurrency=1 --if-present run build
pnpm --filter @open-design/web run build:sidecar
pnpm --filter @open-design/packaged run build
```

`prepare-open-design-linux-resources.mjs` 在非 Linux 上直接拒绝，这次没有跑完整的 linux 资源组装。

## 测试

和 v0.26.1 比，下面这些套件没有失败。
没有在第二份 worktree 里重跑 tag，因为这些命令的结果是全绿，失败数是 0。
没有跑 web、e2e，也没有跑 `tests/runtimes` 和 `server-paths` 以外的 daemon 测试。

| 套件 | 结果 |
|---|---|
| `apps/daemon` `tests/runtimes` | 86 个文件，1546 通过，2 跳过 |
| `apps/daemon` `tests/server-paths.test.ts` | 与 agent24 / plain-stream 一起的 3 个文件、30 个测试通过。后两个也包含在 runtimes 里 |
| `apps/packaged` 全量 | 27 个文件，423 通过 |
| `packages/contracts` 全量 | 84 个文件，901 通过 |
| `tools/pack` 全量 | 44 个文件，343 通过，8 跳过 |

packaged 全量在 desktop 还没构建时，有 3 个文件因 `Cannot find package '@open-design/desktop/main'` 加载失败：
`desktop-pick-and-import.test.ts`、`desktop-project-root-gate.test.ts`、`desktop-url-allowlist.test.ts`。
这三个文件相对 tag 没有 diff。构建 desktop 之后，同一套 packaged 全量 423 通过。

没有打开 Design 页，也没有跑一轮真实的 `agent24 acp`。

## opencode 路径

没有变。仍是 `open-design/bin/libexec/opencode/opencode`。

- `tools/pack/src/vela-cli.ts`：`OPEN_CODE_COMPANION_RELATIVE_PATH = ["libexec", "opencode"]`
- `tools/pack/src/resources/runtime-verification.ts` 读 `open-design/bin/libexec/opencode/opencode`

当前 Agent24 checkout 的 `apps/desktop/scripts` 和 `scripts/verify-mac-signing.sh` 里没有 `libexec/opencode` 这个字符串，也没有计划里写的 `open-design-mac-release.mjs`。
如果签名白名单还在别的分支上写着这条路径，不用改。

## 资源目录

Agent24 已经在检查的这些路径没有变：

- `app/prebundled/agent24-headless.cjs`
- `app/prebundled/agent24-headless.mjs`
- `app/prebundled/daemon/daemon-cli.mjs`
- `app/prebundled/daemon/daemon-sidecar.mjs`
- `app/prebundled/web-sidecar.mjs`
- `open-design/`
- `open-design-web-standalone/`
- `open-design/bin/libexec/opencode/opencode`

headless 协议仍是 2。`resourceSafeBase` 仍是配置字段，由 Agent24 传入。

## Agent24 要改的

把 pin 从 `0.22.2` / `34bc2ba810cf894daff6a7c1736d1cef6c7726b1` 换成 `0.26.1` 和本分支 HEAD：

- `apps/desktop/src/main/creative-serve-web.ts` 的 `OPEN_DESIGN_PIN_VERSION`（`main.ts` 从这里引用）
- `apps/desktop/scripts/pack-open-design-component.mjs` 的 version 和 SHA
- `apps/desktop/scripts/prepare-open-design-linux-resources.mjs` 的 version 和 SHA
- `apps/desktop/scripts/stage-open-design-resources.mjs` 的 version
- `apps/desktop/scripts/rebuild-open-design-native.mjs` 的 SHA

`creative-serve-web.test.ts` 引用上面的常量，跟着走。
这些测试把 `'0.22.2'` 写死成夹具，测的是校验函数本身，不跟 pin 常量走：
`open-design-component.test.ts`、`independent-review.test.ts`、`r2-independent-review.test.ts`、`pack-open-design-component.test.mjs`、`stage-open-design-resources.test.mjs`。

构建命令和资源目录不用改。opencode 白名单字符串不用改。

## 还没做、或没有实测

- 没有在浏览器里打开 Design，也没有用 `agent24 acp` 跑一轮生成。
- 没有在 Linux 上跑 `prepare-open-design-linux-resources.mjs` 的完整资源组装。
- 没有实测「v0.26.1 的 Windows 打包缓存命中 schema 7 后，因缺少启动器被 `invalidate()` 丢掉」。
- daemon 在 `tests/runtimes` 和 `server-paths` 之外的测试没有跑。
- 当前 Agent24 树上没有找到计划里的 `open-design-mac-release.mjs`。
