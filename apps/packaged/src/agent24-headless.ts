import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, dirname, join } from "node:path";

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

export const AGENT24_HEADLESS_PROTOCOL = 1 as const;
export const AGENT24_HEADLESS_NAMESPACE = "agent24-creative";

export type Agent24HeadlessConfig = {
  protocol: typeof AGENT24_HEADLESS_PROTOCOL;
  pinVersion: string;
  resourceRoot: string;
  dataRoot: string;
  runtimeRoot: string;
  runtimeExecutable: string;
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

export function resolveAgent24HeadlessEntries(config: Agent24HeadlessConfig): {
  daemonCliEntry: string;
  daemonSidecarEntry: string;
  webSidecarEntry: string;
  webStandaloneRoot: string;
} {
  return {
    daemonCliEntry: join(config.resourceRoot, "app", "prebundled", "daemon", "daemon-cli.mjs"),
    daemonSidecarEntry: join(config.resourceRoot, "app", "prebundled", "daemon", "daemon-sidecar.mjs"),
    webSidecarEntry: join(config.resourceRoot, "app", "prebundled", "web-sidecar.mjs"),
    webStandaloneRoot: join(dirname(config.resourceRoot), "open-design-web-standalone"),
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

export interface Agent24HeadlessDependencies {
  access(path: string): Promise<void>;
  randomUUID(): string;
  startSidecars: typeof startPackagedSidecars;
}

const DEFAULT_DEPENDENCIES: Agent24HeadlessDependencies = {
  access: async (path) => await access(path),
  randomUUID,
  startSidecars: startPackagedSidecars,
};

export async function startAgent24Headless(
  config: Agent24HeadlessConfig,
  dependencies: Agent24HeadlessDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ close(): Promise<void>; ready: Agent24HeadlessReady }> {
  const paths = resolveAgent24HeadlessPaths(config);
  const entries = resolveAgent24HeadlessEntries(config);
  await Promise.all([
    dependencies.access(config.resourceRoot),
    dependencies.access(config.runtimeExecutable),
    dependencies.access(entries.daemonCliEntry),
    dependencies.access(entries.daemonSidecarEntry),
    dependencies.access(entries.webSidecarEntry),
    dependencies.access(entries.webStandaloneRoot),
  ]);
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
