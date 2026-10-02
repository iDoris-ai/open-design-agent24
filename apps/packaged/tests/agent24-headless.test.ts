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
    expect(() => parseAgent24HeadlessConfig({ ...config, protocol: 2 })).toThrow(/protocol/);
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
      protocol: 1,
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
});
