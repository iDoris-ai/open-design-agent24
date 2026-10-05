import { describe, expect, it, vi } from "vitest";

import {
  AGENT24_HEADLESS_PROTOCOL,
  parseAgent24HeadlessConfig,
  resolveAgent24HeadlessEntries,
  resolveAgent24HeadlessPaths,
  startAgent24Headless,
} from "../src/agent24-headless.js";

const config = parseAgent24HeadlessConfig({
  protocol: AGENT24_HEADLESS_PROTOCOL,
  pinVersion: "0.22.2",
  resourceRoot: "/bundle/resources/open-design",
  dataRoot: "/state/open-design/data",
  runtimeRoot: "/state/open-design/runtime",
  runtimeExecutable: "/bundle/Agent24",
});

describe("agent24-headless", () => {
  it("accepts only the frozen host-managed config surface", () => {
    expect(() => parseAgent24HeadlessConfig({ ...config, rendererPath: "/tmp/user" })).toThrow(/unsupported field/);
    expect(() => parseAgent24HeadlessConfig({ ...config, resourceRoot: "relative" })).toThrow(/must be absolute/);
    expect(() => parseAgent24HeadlessConfig({ ...config, protocol: 1 })).toThrow(/protocol/);
  });

  it("derives daemon and web entries from the pinned resource root", () => {
    expect(resolveAgent24HeadlessEntries(config)).toEqual({
      daemonCliEntry: "/bundle/resources/app/prebundled/daemon/daemon-cli.mjs",
      daemonSidecarEntry: "/bundle/resources/app/prebundled/daemon/daemon-sidecar.mjs",
      webSidecarEntry: "/bundle/resources/app/prebundled/web-sidecar.mjs",
      webStandaloneRoot: "/bundle/resources/open-design-web-standalone",
    });
  });

  it("keeps installation identity in writable state while resources stay packaged", () => {
    const paths = resolveAgent24HeadlessPaths(config);
    expect(paths.installationRoot).toBe("/state/open-design");
    expect(paths.dataRoot).toBe("/state/open-design/data");
    expect(paths.resourceRoot).toBe("/bundle/resources/open-design");
  });

  it("starts the existing packaged sidecars and emits a minimal ready contract", async () => {
    const close = vi.fn(async () => undefined);
    const startSidecars = vi.fn(async (..._args: unknown[]) => ({
      close,
      currentWebUrl: () => "http://127.0.0.1:7456",
      daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
      web: { state: "running" as const, url: "http://127.0.0.1:7456" },
    }));
    const runtime = await startAgent24Headless(config, {
      access: vi.fn(async () => undefined),
      randomUUID: () => "instance-1",
      startSidecars: startSidecars as never,
    });

    expect(startSidecars).toHaveBeenCalledTimes(1);
    expect(startSidecars.mock.calls[0]?.[0]).toMatchObject({
      app: "desktop",
      base: "/state/open-design/runtime",
      mode: "headless",
      namespace: "agent24-creative",
      source: "packaged",
    });
    expect(startSidecars.mock.calls[0]?.[2]).toMatchObject({
      appVersion: "0.22.2",
      electronNodeCommand: "/bundle/Agent24",
      nodeCommand: null,
      requireDesktopAuth: false,
      resourceSafeBase: "/bundle/resources",
      webOutputMode: "standalone",
    });
    expect(runtime.ready).toEqual({
      type: "ready",
      protocol: 2,
      instanceId: "instance-1",
      pinVersion: "0.22.2",
      webOrigin: "http://127.0.0.1:7456",
      daemonOrigin: "http://127.0.0.1:7457",
      ownership: { ownerPid: process.pid, kind: "process-tree" },
    });
    await runtime.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects a resource root outside the packaged runtime resources directory", async () => {
    const startSidecars = vi.fn();
    await expect(startAgent24Headless({
      ...config,
      resourceRoot: "/state/open-design/resources",
    }, {
      access: vi.fn(async () => undefined),
      randomUUID: () => "instance-1",
      startSidecars: startSidecars as never,
    })).rejects.toThrow(/packaged resources directory/);
    expect(startSidecars).not.toHaveBeenCalled();
  });

  it("derives the macOS resource safe base from Contents/MacOS", async () => {
    const macConfig = {
      ...config,
      resourceRoot: "/Applications/Agent24.app/Contents/Resources/open-design",
      runtimeExecutable: "/Applications/Agent24.app/Contents/MacOS/Agent24",
    };
    const close = vi.fn(async () => undefined);
    const startSidecars = vi.fn(async (..._args: unknown[]) => ({
      close,
      currentWebUrl: () => "http://127.0.0.1:7456",
      daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
      web: { state: "running" as const, url: "http://127.0.0.1:7456" },
    }));

    const runtime = await startAgent24Headless(macConfig, {
      access: vi.fn(async () => undefined),
      randomUUID: () => "instance-mac",
      startSidecars: startSidecars as never,
    });

    expect(startSidecars.mock.calls[0]?.[2]).toMatchObject({
      resourceSafeBase: "/Applications/Agent24.app/Contents/Resources",
    });
    await runtime.close();
  });

  it("fails closed on a non-loopback ready endpoint and closes its sidecars", async () => {
    const close = vi.fn(async () => undefined);
    await expect(startAgent24Headless(config, {
      access: vi.fn(async () => undefined),
      randomUUID: () => "instance-1",
      startSidecars: vi.fn(async () => ({
        close,
        currentWebUrl: () => "https://example.com",
        daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
        web: { state: "running" as const, url: "https://example.com" },
      })) as never,
    })).rejects.toThrow(/127\.0\.0\.1/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  describe("v2 explicit resourceSafeBase (on-demand / externally-installed resources)", () => {
    // The externally-installed resourceRoot no longer lives anywhere near
    // runtimeExecutable (e.g. ~/.agent24/components/open-design/<hash>/ on
    // Agent24) — the old runtimeExecutable-derived safe base can never
    // contain it. An explicit, independently-verified resourceSafeBase is
    // the only way to accept this layout without lexical tricks (symlinks)
    // that a real filesystem boundary (readonly AppImage mount, /opt
    // permissions, a signed .app bundle) would reject anyway.
    const externalConfig = parseAgent24HeadlessConfig({
      ...config,
      resourceRoot: "/home/user/.agent24/components/open-design/abc1234-linux-x64/open-design",
      resourceSafeBase: "/home/user/.agent24/components/open-design/abc1234-linux-x64",
    });

    function startSidecarsStub() {
      const close = vi.fn(async () => undefined);
      return {
        close,
        startSidecars: vi.fn(async (..._args: unknown[]) => ({
          close,
          currentWebUrl: () => "http://127.0.0.1:7456",
          daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
          web: { state: "running" as const, url: "http://127.0.0.1:7456" },
        })),
      };
    }

    it("accepts a resourceSafeBase that is its own realpath, owned by the current uid, and not group/other-writable", async () => {
      const { close, startSidecars } = startSidecarsStub();
      const runtime = await startAgent24Headless(externalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        stat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o700 })),
      });
      expect(startSidecars.mock.calls[0]?.[2]).toMatchObject({
        resourceSafeBase: externalConfig.resourceSafeBase,
      });
      await runtime.close();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("rejects a resourceSafeBase that is not its own realpath (symlink indirection)", async () => {
      const { startSidecars } = startSidecarsStub();
      await expect(startAgent24Headless(externalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async () => "/some/other/real/location"),
        stat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o700 })),
      })).rejects.toThrow(/own realpath/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("rejects a resourceRoot that is not under the explicit resourceSafeBase", async () => {
      const { startSidecars } = startSidecarsStub();
      const escaped = parseAgent24HeadlessConfig({
        ...externalConfig,
        resourceRoot: "/home/user/.agent24/components/open-design/other-hash/open-design",
      });
      await expect(startAgent24Headless(escaped, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        stat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o700 })),
      })).rejects.toThrow(/must be under resourceSafeBase/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("rejects a resourceSafeBase owned by a different uid", async () => {
      if (typeof process.getuid !== "function") return; // POSIX-only check
      const { startSidecars } = startSidecarsStub();
      await expect(startAgent24Headless(externalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        stat: vi.fn(async () => ({ uid: process.getuid!() + 1, mode: 0o700 })),
      })).rejects.toThrow(/owned by the current user/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("rejects a resourceSafeBase that is group- or other-writable", async () => {
      if (typeof process.getuid !== "function") return; // POSIX-only check
      const { startSidecars } = startSidecarsStub();
      await expect(startAgent24Headless(externalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        stat: vi.fn(async () => ({ uid: process.getuid!() ?? 0, mode: 0o777 })),
      })).rejects.toThrow(/group- or other-writable/);
      expect(startSidecars).not.toHaveBeenCalled();
    });
  });
});
