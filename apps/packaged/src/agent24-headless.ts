import { randomUUID } from "node:crypto";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, dirname, join, relative, sep } from "node:path";

import {
  APP_KEYS,
  SIDECAR_SOURCES,
} from "@open-design/sidecar-proto";
import type {
  SidecarRuntimeContext,
  SidecarStamp,
} from "@open-design/sidecar";

import type { PackagedNamespacePaths } from "./paths.js";
import {
  startPackagedSidecars,
  type PackagedSidecarHandle,
} from "./sidecars.js";

// v2 (Agent24 on-demand component, 2026-10-05): adds the optional
// resourceSafeBase config field below.
//
// M5 (Opus re-review, 2026-10-06): to be unambiguous — protocol 1 configs
// are NEVER accepted (parseAgent24HeadlessConfig below requires
// raw.protocol === AGENT24_HEADLESS_PROTOCOL, i.e. exactly 2; this has not
// changed and is not what "omitted" refers to below). What CAN be omitted
// on an otherwise-valid protocol-2 config is only the resourceSafeBase
// FIELD itself: a v2 config that simply doesn't set resourceSafeBase still
// gets the exact v1-style derivation (resourceSafeBase computed from
// runtimeExecutable's own location, with the original lenient containment
// check) — not "v1 is accepted", but "v2 without this one optional field
// behaves the way v1 always did". A v2 config that DOES set
// resourceSafeBase is held to the full, stricter v2 contract below
// (H1/H2/M1/M2/M3).
export const AGENT24_HEADLESS_PROTOCOL = 2 as const;
export const AGENT24_HEADLESS_NAMESPACE = "agent24-creative";

export type Agent24HeadlessConfig = {
  protocol: typeof AGENT24_HEADLESS_PROTOCOL;
  pinVersion: string;
  resourceRoot: string;
  dataRoot: string;
  runtimeRoot: string;
  runtimeExecutable: string;
  /**
   * Explicit trust root for resourceRoot (v2, optional). When omitted, the
   * trust root is derived from runtimeExecutable's own location exactly as
   * protocol v1 always did — the app bundle's own Resources dir on mac, or
   * the sibling "resources" directory next to the executable elsewhere.
   * That derivation assumes resourceRoot lives inside the packaged app, so
   * it cannot express a host that installs its resources to an external,
   * on-demand-downloaded location.
   *
   * When given, resourceSafeBase MUST be: an absolute path; its own
   * realpath (no symlink indirection — a lexical "looks like it's inside"
   * is not accepted as a trust boundary); a STRICT ancestor of resourceRoot
   * (resourceRoot === resourceSafeBase is rejected — see H1 below, an entry
   * point computed from dirname(resourceRoot) would otherwise land one
   * level above the verified base); and, on POSIX, owned by the current
   * user with group/other write bits cleared (nothing else can swap its
   * contents out from under this process). This POSIX ownership/mode check
   * additionally walks every directory from $HOME down to resourceSafeBase,
   * and from resourceSafeBase down to resourceRoot and each launcher entry
   * point, applying the same check to each level (M1) — an ancestor a
   * malicious party can rename/replace is just as dangerous as the base
   * itself being writable. win32 has no equivalent ACL model implemented
   * yet, so resourceSafeBase is rejected outright there (M2) rather than
   * silently skipping the check the way the POSIX-only mode bits already
   * do for a missing process.getuid.
   */
  resourceSafeBase?: string;
};

export type Agent24HeadlessReady = {
  type: "ready";
  protocol: typeof AGENT24_HEADLESS_PROTOCOL;
  instanceId: string;
  pinVersion: string;
  webOrigin: string;
  daemonOrigin: string;
  ownership: {
    ownerPid: number;
    kind: "process-tree";
  };
};

const CONFIG_KEYS = new Set([
  "protocol",
  "pinVersion",
  "resourceRoot",
  "dataRoot",
  "runtimeRoot",
  "runtimeExecutable",
  "resourceSafeBase",
]);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`agent24-headless config ${field} must be a non-empty string`);
  }
  return value;
}

function requireAbsolutePath(value: unknown, field: string): string {
  const parsed = requireNonEmptyString(value, field);
  if (!isAbsolute(parsed)) {
    throw new Error(`agent24-headless config ${field} must be absolute`);
  }
  return parsed;
}

export function parseAgent24HeadlessConfig(value: unknown): Agent24HeadlessConfig {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent24-headless config must be an object");
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`agent24-headless config contains unsupported field: ${unknown[0]}`);
  }
  if (raw.protocol !== AGENT24_HEADLESS_PROTOCOL) {
    throw new Error(`agent24-headless config protocol must be ${AGENT24_HEADLESS_PROTOCOL}`);
  }
  const pinVersion = requireNonEmptyString(raw.pinVersion, "pinVersion");
  if (/\s/u.test(pinVersion)) {
    throw new Error("agent24-headless config pinVersion must not contain whitespace");
  }
  return {
    protocol: AGENT24_HEADLESS_PROTOCOL,
    pinVersion,
    resourceRoot: requireAbsolutePath(raw.resourceRoot, "resourceRoot"),
    dataRoot: requireAbsolutePath(raw.dataRoot, "dataRoot"),
    runtimeRoot: requireAbsolutePath(raw.runtimeRoot, "runtimeRoot"),
    runtimeExecutable: requireAbsolutePath(raw.runtimeExecutable, "runtimeExecutable"),
    resourceSafeBase: raw.resourceSafeBase == null
      ? undefined
      : requireAbsolutePath(raw.resourceSafeBase, "resourceSafeBase"),
  };
}

export function resolveAgent24HeadlessPaths(config: Agent24HeadlessConfig): PackagedNamespacePaths {
  const namespaceRoot = dirname(config.runtimeRoot);
  const logsRoot = join(namespaceRoot, "logs");
  return {
    cacheRoot: join(namespaceRoot, "cache"),
    dataRoot: config.dataRoot,
    desktopLogPath: join(logsRoot, APP_KEYS.DESKTOP, "latest.log"),
    desktopLogsRoot: join(logsRoot, APP_KEYS.DESKTOP),
    electronSessionDataRoot: join(namespaceRoot, "user-data", "session"),
    electronUserDataRoot: join(namespaceRoot, "user-data"),
    installationRoot: dirname(config.dataRoot),
    installerObservationRoot: join(config.dataRoot, "observations", "installer"),
    logsRoot,
    namespaceRoot,
    resourceRoot: config.resourceRoot,
    runtimeRoot: config.runtimeRoot,
    updateRoot: join(namespaceRoot, "updates"),
  };
}

function resolveAgent24ResourceSafeBase(runtimeExecutable: string): string {
  const runtimeDir = dirname(runtimeExecutable);
  const parentDir = dirname(runtimeDir);
  return basename(runtimeDir) === "MacOS" && basename(parentDir) === "Contents"
    ? join(parentDir, "Resources")
    : join(runtimeDir, "resources");
}

// H1 (Opus re-review, 2026-10-06): the v1 fallback's containment check
// accepts resourceRoot === safeBase (rel === ""), which is fine for v1 —
// resolveAgent24ResourceSafeBase always derives a real ancestor, never
// something equal to resourceRoot. The v2 explicit path must not repeat
// that leniency: resolveAgent24HeadlessEntries derives every launcher
// entry from dirname(resourceRoot), so resourceRoot === resourceSafeBase
// would place every entry point ONE LEVEL ABOVE the verified base —
// entirely outside it — while resourceRoot itself still "passed"
// containment under the lenient check. isStrictlyUnderSafeBase below is
// what the v2 path uses instead.
function isUnderSafeBase(safeBase: string, candidate: string): boolean {
  const rel = relative(safeBase, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isStrictlyUnderSafeBase(safeBase: string, candidate: string): boolean {
  const rel = relative(safeBase, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export interface ResourceSafeBaseDependencies {
  // Only ever called on the v2 explicit-resourceSafeBase path (see
  // assertAgent24ResourceRoot below). Existing v1-only callers/tests (no
  // resourceSafeBase in their config) never need to supply these.
  realpath?(path: string): Promise<string>;
  /** M1 (Opus re-review): lstat, not stat — used uniformly for the
   * $HOME-to-safeBase ancestor chain (never separately realpath'd, so a
   * symlink there must report as itself, not be silently followed) as well
   * as for paths that HAVE already been realpath'd (where lstat and stat
   * give the same answer anyway). dev/ino are included for the
   * TOCTOU re-check right before spawning — see assertAgent24ResourceRoot's
   * returned verify(). */
  lstat?(path: string): Promise<{ uid: number; mode: number; dev: number; ino: number }>;
  /** Injectable for tests; defaults to node:os's real homedir(). */
  homedir?(): string;
}

const DEFAULT_RESOURCE_SAFE_BASE_DEPENDENCIES: Required<ResourceSafeBaseDependencies> = {
  realpath: async (path) => await realpath(path),
  lstat: async (path) => {
    const info = await lstat(path);
    return { uid: info.uid, mode: info.mode, dev: info.dev, ino: info.ino };
  },
  homedir,
};

// M1: sticky-bit directories (e.g. /tmp, mode 1777) are the standard safe
// exception to "group/other writable" — the sticky bit stops anyone but a
// file's own owner from renaming or removing it inside such a directory,
// which is the actual property this check cares about.
function hasUnsafeWriteBits(mode: number): boolean {
  if ((mode & 0o1000) !== 0) return false;
  return (mode & 0o022) !== 0;
}

// Only called once the caller has confirmed process.platform !== "win32"
// (see the M2 check in assertAgent24ResourceRoot), so process.getuid is
// always available here.
function ownerIsTrusted(uid: number): boolean {
  return uid === process.getuid!() || uid === 0;
}

async function assertPathIsSafe(
  targetPath: string,
  dependencies: Required<Pick<ResourceSafeBaseDependencies, "lstat">>,
): Promise<void> {
  const info = await dependencies.lstat(targetPath);
  if (!ownerIsTrusted(info.uid)) {
    throw new Error(`agent24-headless config resourceSafeBase path is not owned by the current user or root: ${targetPath}`);
  }
  if (hasUnsafeWriteBits(info.mode)) {
    throw new Error(`agent24-headless config resourceSafeBase path is group- or other-writable without the sticky bit: ${targetPath}`);
  }
}

function chainFromAncestor(ancestor: string, target: string): string[] {
  const rel = relative(ancestor, target);
  if (rel === "") return [ancestor];
  const segments = rel.split(sep).filter((segment) => segment.length > 0);
  const chain = [ancestor];
  let acc = ancestor;
  for (const segment of segments) {
    acc = join(acc, segment);
    chain.push(acc);
  }
  return chain;
}

function rootToTargetChain(target: string): string[] {
  const segments = target.split(sep).filter((segment) => segment.length > 0);
  const chain: string[] = [];
  let acc = "";
  for (const segment of segments) {
    acc = `${acc}${sep}${segment}`;
    chain.push(acc);
  }
  return chain;
}

// M1: the original check only looked at resourceSafeBase itself. A
// malicious (or merely misconfigured) ancestor directory — one that is
// group/other-writable without the sticky bit, or owned by neither the
// current user nor root — can rename or replace resourceSafeBase out from
// under an otherwise-correct check, even though resourceSafeBase's OWN
// stat looks fine at the instant it's inspected. Walk the full ancestor
// chain from $HOME down to resourceSafeBase (or from the filesystem root,
// if resourceSafeBase is not under $HOME), plus resourceSafeBase's own
// subtree down to resourceRoot and each launcher entry point — the same
// "could someone swap this out" question applies all the way down, not
// just at the top.
async function assertResourceSafeBaseAncestryIsSafe(
  safeBase: string,
  subtreeTargets: readonly string[],
  dependencies: Required<Pick<ResourceSafeBaseDependencies, "lstat" | "homedir">>,
): Promise<void> {
  const home = dependencies.homedir();
  const ancestorChain = isUnderSafeBase(home, safeBase) ? chainFromAncestor(home, safeBase) : rootToTargetChain(safeBase);
  const subtreeChains = subtreeTargets.flatMap((target) => chainFromAncestor(safeBase, target));
  const allPaths = new Set([...ancestorChain, ...subtreeChains]);
  for (const target of allPaths) await assertPathIsSafe(target, dependencies);
}

async function assertAgent24ResourceRoot(
  config: Agent24HeadlessConfig,
  dependencies: ResourceSafeBaseDependencies = DEFAULT_RESOURCE_SAFE_BASE_DEPENDENCIES,
): Promise<{ resourceSafeBase: string; resourceRoot: string; verify(): Promise<void> }> {
  if (config.resourceSafeBase == null) {
    // v1-compatible fallback: unchanged derivation + lexical containment
    // check, no realpath, no ownership/mode checks. A host that never
    // adopts resourceSafeBase keeps working exactly as before.
    const safeBase = resolveAgent24ResourceSafeBase(config.runtimeExecutable);
    if (!isUnderSafeBase(safeBase, config.resourceRoot)) {
      throw new Error("agent24-headless config resourceRoot must be under the packaged resources directory");
    }
    return { resourceSafeBase: safeBase, resourceRoot: config.resourceRoot, verify: async () => {} };
  }

  // M2: no Windows ACL model is implemented for the explicit-safe-base
  // path yet. Fail closed rather than silently running the POSIX
  // ownership/mode checks below, which would be meaningless on win32 (no
  // process.getuid) and would otherwise leave this whole contract
  // unenforced there without ever saying so.
  if (process.platform === "win32") {
    throw new Error("agent24-headless config resourceSafeBase is not supported on win32 yet");
  }

  const safeBase = config.resourceSafeBase;
  const deps: Required<ResourceSafeBaseDependencies> = { ...DEFAULT_RESOURCE_SAFE_BASE_DEPENDENCIES, ...dependencies };
  const resolvedBase = await deps.realpath(safeBase);
  if (resolvedBase !== safeBase) {
    throw new Error("agent24-headless config resourceSafeBase must be its own realpath (no symlink indirection)");
  }

  // H1: resourceRoot === resourceSafeBase must be rejected — see the
  // isUnderSafeBase doc comment above for why.
  if (!isStrictlyUnderSafeBase(safeBase, config.resourceRoot)) {
    throw new Error("agent24-headless config resourceRoot must be strictly under resourceSafeBase");
  }

  // H2: resourceRoot itself was never realpath'd before. Resolve it and
  // re-check containment against the RESOLVED value — what a symlink
  // somewhere inside resourceRoot's own path actually points at, not just
  // its lexical spelling. The resolved value is what gets used everywhere
  // downstream (paths.resourceRoot / the sidecar's OD_RESOURCE_ROOT), not
  // the raw config value.
  const resolvedResourceRoot = await deps.realpath(config.resourceRoot);
  if (!isStrictlyUnderSafeBase(safeBase, resolvedResourceRoot)) {
    throw new Error("agent24-headless config resourceRoot's realpath must be strictly under resourceSafeBase");
  }

  // H1 (entries): each launcher entry point is realpath'd and re-checked
  // the same way — resourceRoot escaping safeBase is already caught above,
  // but a symlink inside resourceRoot's own subtree could still make one
  // specific entry resolve outside safeBase even while resourceRoot itself
  // resolves fine.
  const lexicalEntries = resolveAgent24HeadlessEntries({ ...config, resourceRoot: resolvedResourceRoot });
  const resolvedEntries = {
    daemonCliEntry: await deps.realpath(lexicalEntries.daemonCliEntry),
    daemonSidecarEntry: await deps.realpath(lexicalEntries.daemonSidecarEntry),
    webSidecarEntry: await deps.realpath(lexicalEntries.webSidecarEntry),
    webStandaloneRoot: await deps.realpath(lexicalEntries.webStandaloneRoot),
  };
  for (const [field, resolvedEntry] of Object.entries(resolvedEntries)) {
    if (!isStrictlyUnderSafeBase(safeBase, resolvedEntry)) {
      throw new Error(`agent24-headless config ${field}'s realpath must be strictly under resourceSafeBase`);
    }
  }

  // M3: the writable state tree must never overlap the (host-enforced
  // read-only, per Agent24's installer) resource tree — otherwise a
  // compromised sidecar writing into its own state dir could write INTO
  // the trusted resource tree.
  for (const [field, candidate] of [
    ["dataRoot", config.dataRoot],
    ["runtimeRoot", config.runtimeRoot],
    ["dataRoot's installation root", dirname(config.dataRoot)],
  ] as const) {
    if (isUnderSafeBase(safeBase, candidate)) {
      throw new Error(`agent24-headless config ${field} must not be under resourceSafeBase`);
    }
  }

  // M1: ownership/writability all the way from $HOME down to
  // resourceSafeBase, and from resourceSafeBase down to resourceRoot and
  // every entry point.
  await assertResourceSafeBaseAncestryIsSafe(safeBase, [resolvedResourceRoot, ...Object.values(resolvedEntries)], deps);

  const snapshot = await deps.lstat(safeBase);
  return {
    resourceSafeBase: safeBase,
    resourceRoot: resolvedResourceRoot,
    // M1 (TOCTOU): re-lstat safeBase right before the caller spawns
    // anything and compare (dev, ino) against what was just verified —
    // catches a swap landing in the window between this check and the
    // spawn.
    async verify() {
      const current = await deps.lstat(safeBase);
      if (current.dev !== snapshot.dev || current.ino !== snapshot.ino) {
        throw new Error("agent24-headless config resourceSafeBase changed after it was verified (possible TOCTOU swap)");
      }
    },
  };
}

export function resolveAgent24HeadlessEntries(config: Agent24HeadlessConfig): {
  daemonCliEntry: string;
  daemonSidecarEntry: string;
  webSidecarEntry: string;
  webStandaloneRoot: string;
} {
  const resourcesRoot = dirname(config.resourceRoot);
  return {
    daemonCliEntry: join(resourcesRoot, "app", "prebundled", "daemon", "daemon-cli.mjs"),
    daemonSidecarEntry: join(resourcesRoot, "app", "prebundled", "daemon", "daemon-sidecar.mjs"),
    webSidecarEntry: join(resourcesRoot, "app", "prebundled", "web-sidecar.mjs"),
    webStandaloneRoot: join(resourcesRoot, "open-design-web-standalone"),
  };
}

function requireLoopbackHttpOrigin(raw: string | null | undefined, field: string): string {
  if (raw == null || raw.length === 0) throw new Error(`${field} did not report an origin`);
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(`${field} must report an exact 127.0.0.1 http origin`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${field} reported a non-origin URL`);
  }
  return parsed.origin;
}

export interface Agent24HeadlessDependencies extends ResourceSafeBaseDependencies {
  access(path: string): Promise<void>;
  randomUUID(): string;
  startSidecars: typeof startPackagedSidecars;
}

const DEFAULT_DEPENDENCIES: Agent24HeadlessDependencies = {
  access: async (path) => await access(path),
  randomUUID,
  startSidecars: startPackagedSidecars,
  ...DEFAULT_RESOURCE_SAFE_BASE_DEPENDENCIES,
};

export async function startAgent24Headless(
  config: Agent24HeadlessConfig,
  dependencies: Agent24HeadlessDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ close(): Promise<void>; ready: Agent24HeadlessReady }> {
  const resolved = await assertAgent24ResourceRoot(config, dependencies);
  // H2: everything downstream (paths.resourceRoot, entry derivation, and
  // ultimately the sidecar's OD_RESOURCE_ROOT) uses the realpath'd
  // resourceRoot resolved above, not the raw config value.
  const resolvedConfig: Agent24HeadlessConfig = { ...config, resourceRoot: resolved.resourceRoot };
  const paths = resolveAgent24HeadlessPaths(resolvedConfig);
  const entries = resolveAgent24HeadlessEntries(resolvedConfig);
  await Promise.all([
    dependencies.access(resolvedConfig.resourceRoot),
    dependencies.access(config.runtimeExecutable),
    dependencies.access(entries.daemonCliEntry),
    dependencies.access(entries.daemonSidecarEntry),
    dependencies.access(entries.webSidecarEntry),
    dependencies.access(entries.webStandaloneRoot),
  ]);
  // M1 (TOCTOU): re-check resourceSafeBase immediately before spawning
  // anything — closes the window between assertAgent24ResourceRoot's
  // checks above and actually starting the sidecars. A no-op on the v1
  // fallback path (see assertAgent24ResourceRoot).
  await resolved.verify();
  const runtime: SidecarRuntimeContext<SidecarStamp> = {
    app: APP_KEYS.DESKTOP,
    base: config.runtimeRoot,
    mode: "headless",
    namespace: AGENT24_HEADLESS_NAMESPACE,
    source: SIDECAR_SOURCES.PACKAGED,
  };
  let sidecars: PackagedSidecarHandle | null = null;
  try {
    sidecars = await dependencies.startSidecars(runtime, paths, {
      appVersion: config.pinVersion,
      amrProfile: null,
      daemonCliEntry: entries.daemonCliEntry,
      daemonSidecarEntry: entries.daemonSidecarEntry,
      electronNodeCommand: config.runtimeExecutable,
      nodeCommand: null,
      mcpBootstrapCommand: null,
      mcpBootstrapArgs: [],
      telemetryRelayUrl: null,
      posthogKey: null,
      posthogHost: null,
      resourceSafeBase: resolved.resourceSafeBase,
      velaWebUrl: null,
      velaWebUrls: {},
      requireDesktopAuth: false,
      webSidecarEntry: entries.webSidecarEntry,
      webStandaloneRoot: entries.webStandaloneRoot,
      webOutputMode: "standalone",
    });
    const ready: Agent24HeadlessReady = {
      type: "ready",
      protocol: AGENT24_HEADLESS_PROTOCOL,
      instanceId: dependencies.randomUUID(),
      pinVersion: config.pinVersion,
      webOrigin: requireLoopbackHttpOrigin(sidecars.web.url, "web sidecar"),
      daemonOrigin: requireLoopbackHttpOrigin(sidecars.daemon.url, "daemon sidecar"),
      ownership: { ownerPid: process.pid, kind: "process-tree" },
    };
    return {
      ready,
      async close() {
        const owned = sidecars;
        sidecars = null;
        await owned?.close();
      },
    };
  } catch (error) {
    await sidecars?.close().catch(() => undefined);
    throw error;
  }
}

function parseConfigArg(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--config" || argv[1].length === 0) {
    throw new Error("usage: agent24-headless.cjs --config <managed-config>");
  }
  if (!isAbsolute(argv[1])) throw new Error("agent24-headless config path must be absolute");
  return argv[1];
}

export async function runAgent24HeadlessCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const configPath = parseConfigArg(argv);
  const config = parseAgent24HeadlessConfig(JSON.parse(await readFile(configPath, "utf8")));
  let runtime: Awaited<ReturnType<typeof startAgent24Headless>> | null = null;
  let stopRequested = false;
  let stopStarted = false;
  let resolveStopped!: () => void;
  let rejectStopped!: (error: unknown) => void;
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  const stop = (): void => {
    stopRequested = true;
    if (stopStarted || runtime == null) return;
    stopStarted = true;
    void runtime.close().then(resolveStopped, rejectStopped);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    runtime = await startAgent24Headless(config);
    if (stopRequested) {
      stop();
      await stopped;
      return;
    }
    process.stdout.write(`${JSON.stringify(runtime.ready)}\n`);
    await stopped;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    if (runtime != null && !stopStarted) await runtime.close().catch(() => undefined);
  }
}
