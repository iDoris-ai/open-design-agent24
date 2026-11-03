# Agent24 补丁清单

每次把上游 Open Design 合进 `agent24/v0.26.1`（或下一次 pin）时，按下面逐条复核。
一条没复核，就不算升级完成。

对照底是 tag `open-design-v0.26.1`（`ac476788b7`）。
ODX-1 的搬入记录在 [UPGRADE-v0.26.1.md](./UPGRADE-v0.26.1.md)。
本清单写的是搬入之后又叠上去的行为，以及 ODX-1 里必须留下的启动器和运行时。

`isAgent24Shell()` 只在 web 客户端读 `globalThis.__OD_IS_AGENT24__`。
sidecar namespace `agent24-creative` 才会注入这个标志。上游 namespace 没有这段脚本，标志为假，上游行为保持原样。

## 1. headless 启动器和 resourceSafeBase

目的：Agent24 用 headless 启动器拉起 daemon 和 web sidecar，不启 Electron。资源根由调用方传入的 `resourceSafeBase` 圈定，不能退回「资源目录自己就是信任根」的宽松推导。

涉及的文件：

- `apps/packaged/src/agent24-headless.ts`
- `apps/packaged/src/sidecars.ts`（把 `resourceSafeBase` 交进打包 sidecar 环境）
- `apps/packaged/esbuild.config.mjs`、`apps/packaged/package.json`（`agent24-headless` 的 export 和打包）
- `tools/pack/src/mac/app.ts`、`tools/pack/src/linux.ts`、`tools/pack/src/win/app.ts`、`tools/pack/src/resources/index.ts`（把启动器拷进 prebundled）
- `apps/daemon/src/server.ts`（打包资源信任根和会话环境，跟启动器一起看）

落点提交：`e8ef761183`、`afff16c48c`、`73b200b719`、`eeccd0370d`、`2caba9071e`，复审修复 `6e990e16a2`、`dea1ca8862`、`b360a08527`、`f37d5fb7d4`。

怎么验证：

- 自动：`apps/packaged/tests/agent24-headless.test.ts`（`agent24-headless`，含 `v2 explicit resourceSafeBase`）。`apps/packaged/tests/sidecars.test.ts`。`tools/pack/tests/resources/resources.test.ts`。
- 手工：headless 就绪后 namespace 是 `agent24-creative`。配置里带 `resourceSafeBase`。缺启动器文件时打包校验会失败，而不是静默用上游 Electron 入口。

上游哪类改动最容易冲掉：`tools/pack` 的 mac/linux/win 组装顺序、`finalizeRuntimeManifest`、sidecar 环境变量组装（上次就是 `sidecars.ts` 和 `tools/pack/src/win/app.ts` 冲突）。还有把 `resourceSafeBase` 改回可选、或把资源根校验放宽到等于 safe base。

## 2. agent24 runtime

目的：daemon 里有一个名为 `agent24` 的 ACP runtime。可见文本产物要落盘，重复产物要更新，长产物不截断。分析事件的 provider 枚举里要有 `agent24`。

涉及的文件：

- `apps/daemon/src/runtimes/defs/agent24.ts`
- `apps/daemon/src/runtimes/registry.ts`
- `apps/daemon/src/runtimes/types.ts`
- `apps/daemon/src/runtimes/plain-stream.ts`
- `apps/daemon/src/server.ts`（产物落盘）
- `apps/daemon/src/runtimes/auth.ts`
- `packages/contracts/src/analytics/events/shared-enums.ts`
- `packages/contracts/src/analytics/events/mappers.ts`

落点提交：`44fe4d409a`、`9682d18448`、`7427a1f2fb`、`a1dd3f2c41`、`05799ddad6`。

怎么验证：

- 自动：`apps/daemon/tests/runtimes/agent24.test.ts`（`Agent24 runtime adapter`）。`apps/daemon/tests/runtimes/plain-stream.test.ts`。`packages/contracts/tests/analytics-agent-provider.test.ts`。
- 手工：新建项目的默认 runtime 能选到 `agent24`，跑一轮后产物还在，长文本没有被截断。

上游哪类改动最容易冲掉：runtime registry 的注册表、`server.ts` 里产物写入、plain-stream 的去重，以及 analytics provider 枚举。`server.ts` 每次上游大版本都会大改。

## 3. ODX-2：右上角 GitHub / 积分按钮

目的：Agent24 壳里不渲染右上角 GitHub 星和积分 pill，也不请求星数。设计文件面板里的 GitHub 链接、设置 About 里的 release notes 链接是信息链接，留下。

涉及的文件：

- `apps/web/src/runtime/agent24-shell.ts`
- `apps/web/sidecar/agent24-shell.ts`、`apps/web/sidecar/index.ts`、`apps/web/sidecar/server.ts`（注入 `__OD_IS_AGENT24__`）
- `apps/web/src/components/EntryNavRail.tsx`
- `apps/web/src/components/useGithubStars.ts`
- `apps/web/src/components/DesignFilesPanel.tsx`（`https://github.com/nexu-io/open-design` 这条 useful tip 要留）

落点提交：`dee6f6ad20`，合入 `d0a9d98201`。

怎么验证：

- 自动：`apps/web/tests/components/EntryNavRail.agent24-top-right.test.tsx`（`omits both controls on Home and the project cluster in Agent24, and does not request star counts`）。`apps/web/tests/sidecar-agent24-shell.test.ts`（三处 namespace 常量相等）。
- 手工：Agent24 首页和项目页右上角没有星和积分。设计文件面板的 GitHub 链接还在。上游构建里这两颗按钮还在。

上游哪类改动最容易冲掉：`EntryNavRail` 的顶栏重排、星数 hook 的 `enabled` 条件、sidecar 注入脚本被换掉。新的顶栏按钮如果没接 `isAgent24Shell()`，会在 Agent24 里重新冒出来。

## 4. ODX-3：DisabledCloudAccount 和 IdentityBridge

目的：Agent24 不连 Open Design 云账户。daemon 默认 `DisabledCloudAccount`，不连 `amr-api.open-design.ai`，AMR 等云 agent 在开跑时被拒（`CLOUD_ACCOUNT_REQUIRED`）。Web 默认 `LocalSingleUser`，`cloud` 为 null。`isCloudAccountEnabled()` 为假时不发 workspace 头、不打 AMR/Vela。

涉及的文件：

- `apps/daemon/src/identity/cloud-account.ts`
- `apps/daemon/src/server.ts`（默认挂上 disabled 路由；`failRun('CLOUD_ACCOUNT_REQUIRED')`）
- `apps/daemon/src/connectionTest.ts`、`apps/daemon/src/memory-llm.ts`、`apps/daemon/src/routes/media.ts`、`apps/daemon/src/routes/routine.ts`、`apps/daemon/src/automations/workspace-scope.ts`、`apps/daemon/src/langfuse-trace.ts`（云账户关闭时不走 Vela / amr-api）
- `apps/web/src/identity/IdentityBridge.ts`
- `apps/web/src/identity/LocalAccountNotice.tsx`、`apps/web/src/identity/local-account-copy.ts`
- `apps/web/src/collab/useWorkspaceContext.ts`、`apps/web/src/analytics/amr-attribution.ts`、`apps/web/src/runtime/amr-guidance.ts`

落点提交：`6e89e989e0`、`a1131ddb12`、`b31902db82`、`e5e1fbe314`、`ec9966db93`、`e42a2926a5`，合入 `18b13bb941`。

怎么验证：

- 自动：`apps/daemon/tests/identity/cloud-account.test.ts`（`DisabledCloudAccount`、`startServer under DisabledCloudAccount` 里的 `refuses the AMR cloud agent at run start`）。`apps/web/tests/identity/cloud-account.test.tsx`（`does not request amr-api or vela origins from the web choke points`、`shows a no-retry "cloud account not connected" card for a refused AMR run`）。
- 手工：抓包没有 `amr-api.open-design.ai`。选 AMR 开跑得到「云账户未连接」，没有重试把请求打出去。上游测试显式注入 `EnabledCloudAccount` 的路径仍然走云。

上游哪类改动最容易冲掉：`server.ts` 的账户装配、新的云路由没走 `isCloudAccountEnabled()`、IdentityBridge 的默认身份被改回云账户、AMR 错误码不再是 `CLOUD_ACCOUNT_REQUIRED`。上游登录和席位改动最常碰到这几处。

## 5. ODX-6：小人

目的：只在 Agent24 首页标题旁放 iDoris 像素小人。素材是 48×66 的格子 SVG，不是上游字标。上游首页没有这只小人。

涉及的文件：

- `apps/web/public/idoris-mascot/idle.svg`、`thinking.svg`、`success.svg`、`error.svg`
- `apps/web/src/components/home-hero/IDorisMascot.tsx`
- `apps/web/src/components/HomeHero.tsx`
- `apps/web/src/styles/home/home-hero.css`

落点提交：`9b73305779`，合入 `21695318f5`。

怎么验证：

- 自动：`apps/web/tests/components/home-idoris-mascot.test.tsx`（`renders the idle pixel mascot beside the rotating title in the Agent24 shell`、`leaves the upstream home title without a mascot`）。`apps/web/tests/components/home-logo-assets.test.ts`（`points the Agent24 home mascot at the pixel iDoris poses`）。
- 手工：Agent24 首页标题旁有小人。上游首页标题是原来的句子，没有小人。

上游哪类改动最容易冲掉：`HomeHero` 标题结构（`RotatingTitleWord`、`--with-mascot`）、`home-hero.css` 里小人那一段被整段覆盖。

## 6. 升级 / 新版本弹窗，以及小人动画

目的：Agent24 里不出现「OpenDesign x.y.z is here」，也不出现 OD 自己的升级入口，并且不请求 `whatsnew.open-design.ai`、不跑 OD 的升级检查。OD 的版本由 Agent24 改 pin 发出。小人在待机时要看得出在动，系统要求减少动态时停在 idle。

弹窗怎么关：

- `WhatsNewPopup`、`UpdaterPopup`、`UpdateDialog` 在 `isAgent24Shell()` 为真时直接返回，不跑组件内部的 hook，因此不打 `/api/whats-new`，也不订阅 host updater。挂载点仍在 `EntryShell.tsx` 和 `App.tsx`，没有改那两个文件。
- `UpdateDialog` 整份隐藏。它一打开就会 `checkForUpdaterUpdate`，还有下载和安装，本身就是升级入口。对话框里的 GitHub releases 链接跟着这份入口一起消失。设计文件面板的 GitHub 链接，以及设置 About 里的 release notes 链接，按 ODX-2 留下。
- 设置 About 在 Agent24 里不订阅 updater，不显示检查 / 下载 / 安装、静默更新和清缓存。release notes 链接留下。
- 真正打到 `https://whatsnew.open-design.ai/whats-new.json` 的是 daemon。`whatsNewSourceUrl` 在 `OD_SIDECAR_NAMESPACE=agent24-creative` 时返回 null，有 `OD_WHATS_NEW_URL` 也不发。没有后台轮询，只有这条路由被打到才会 fetch。
- OD 自己的定时升级检查在 Electron 桌面端 `apps/desktop/src/main/updater/scheduler.ts`。Agent24 headless 不启 Electron，这条调度不会跑。不要为了 Agent24 去改桌面调度器。

涉及的文件：

- `apps/web/src/components/WhatsNewPopup.tsx`
- `apps/web/src/components/UpdaterPopup.tsx`
- `apps/web/src/components/UpdateDialog.tsx`
- `apps/web/src/components/SettingsDialog.tsx`（About 的升级控件）
- `apps/daemon/src/services/whats-new.ts`
- `apps/web/public/idoris-mascot/blink.svg`
- `apps/web/src/components/home-hero/IDorisMascot.tsx`
- `apps/web/src/styles/home/home-hero.css`

怎么验证：

- 自动：`apps/web/tests/components/agent24-popups.test.tsx`（`renders neither popup and does not request whatsnew in the Agent24 shell`、`keeps the upstream popups and the whats-new fetch outside the Agent24 shell`）。`apps/daemon/tests/whats-new.test.ts`（`refuses the hosted document for the Agent24 sidecar namespace, even with an override`、`does not fetch when the sidecar namespace is agent24-creative`）。`apps/web/tests/components/home-logo-assets.test.ts`（`ships a blink frame the same size as idle, changing only the eye cells`）。`apps/web/tests/components/home-idoris-mascot.test.tsx`（`stops float, sway, blink, and hover under prefers-reduced-motion: reduce`）。
- 手工：Agent24 首页没有升级弹窗，网络面板没有 `whatsnew.open-design.ai`。小人上下大约 5px、轻轻摆、大约每 4 秒眨一次，悬停会跳一下。系统开了「减少动态」后停在睁眼的 idle。`blink.svg` 只改了眼睛：左眼闭眼线是 y=26、x=13–15 的黑线，右眼闭眼线是 y=25、x=22–26 的黑线，列出的瞳孔和眼白改成皮肤色 `#F9D7B9`。预览图给 jason 看过再算数。

上游哪类改动最容易冲掉：`WhatsNewPopup` / `UpdaterPopup` / `UpdateDialog` / `SettingsDialog` About 被重写后，短路如果只留在挂载点就会丢。`whatsNewSourceUrl` 如果又把 `OD_WHATS_NEW_URL` 放回最前面，Agent24 会重新打出去。`home-hero.css` 的小人动画和 `prefers-reduced-motion` 段被覆盖。`idle.svg` 重导出后 `blink.svg` 的眼睛对不齐。

## 7. 跳过引导页（待合入）

状态：还没进 `agent24/v0.26.1`，也不在本分支。在 `agent24/odx-skip-onboarding` 的 `33608fab50`（`fix(web): Agent24 跳过首次引导页，空 agent 槽默认 agent24`）。合入之后把这一节改成已合入，并按那个提交复核。

目的：`isAgent24Shell()` 为真时，启动把引导标成已完成，没有已选 agent 时写入 `agent24`。手动打开 `/onboarding` 回到 Home。上游仍进引导页。

涉及的文件（以 `33608fab50` 为准，合入时再对一遍 diff）：

- `apps/web/src/runtime/agent24-onboarding.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/EntryShell.tsx`
- `apps/web/tests/App.test.ts`
- `apps/web/tests/components/App.agent24-skip-onboarding.test.tsx`
- `apps/web/tests/runtime/agent24-onboarding.test.ts`

怎么验证：

- 自动：`Agent24 skips first-run onboarding`（`opens Home on the agent24 runtime and persists completion for a fresh shell`、`replaces a manual /onboarding visit with Home`、`still routes a fresh upstream install to onboarding and does not pick agent24`）。`Agent24 first-run defaults`。
- 手工：Agent24 第一次打开是 Home，不是引导页。地址栏进 `/onboarding` 回到 Home。上游全新安装仍进引导页。

上游哪类改动最容易冲掉：`App.tsx` 的启动路由和 `onboardingCompleted` 写入、`EntryShell` 的引导导航。这两处每次上游改登录或首页都会动。合入时不要顺手把本清单第 6 节的弹窗短路搬进这两个文件；短路留在弹窗组件里。
