import { access as realAccess } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

  // M5 (Opus re-review, 2026-10-06): proves the v1 fallback (resourceSafeBase
  // omitted) is untouched by H1's stricter v2 check — resourceRoot equal to
  // the DERIVED safe base is still accepted here, exactly as it always was.
  // H1 only tightens the branch where a host explicitly SETS
  // resourceSafeBase (see the "v2 explicit resourceSafeBase" describe
  // block below).
  it("v2 config without resourceSafeBase keeps the old, lenient v1 derivation (resourceRoot === derived base is still accepted)", async () => {
    const close = vi.fn(async () => undefined);
    const startSidecars = vi.fn(async (..._args: unknown[]) => ({
      close,
      currentWebUrl: () => "http://127.0.0.1:7456",
      daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
      web: { state: "running" as const, url: "http://127.0.0.1:7456" },
    }));
    const cfg = parseAgent24HeadlessConfig({
      ...config,
      resourceRoot: "/bundle/resources", // equals resolveAgent24ResourceSafeBase("/bundle/Agent24") exactly
      runtimeExecutable: "/bundle/Agent24",
    });
    const runtime = await startAgent24Headless(cfg, {
      access: vi.fn(async () => undefined),
      randomUUID: () => "instance-v1-equal",
      startSidecars: startSidecars as never,
    });
    expect(startSidecars.mock.calls[0]?.[2]).toMatchObject({ resourceSafeBase: "/bundle/resources" });
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

  describe("v2 explicit resourceSafeBase (on-demand / externally-installed resources) — mocked fs", () => {
    // The externally-installed resourceRoot no longer lives anywhere near
    // runtimeExecutable (e.g. ~/.agent24/components/open-design/<hash>/ on
    // Agent24) — the old runtimeExecutable-derived safe base can never
    // contain it. An explicit, independently-verified resourceSafeBase is
    // the only way to accept this layout without lexical tricks (symlinks)
    // that a real filesystem boundary (readonly AppImage mount, /opt
    // permissions, a signed .app bundle) would reject anyway.
    //
    // These tests mock realpath/lstat/homedir entirely — fast, deterministic
    // coverage of the pure decision logic. The "real tmpdir filesystem"
    // describe block further below additionally proves the REAL,
    // unmocked fs-backed dependencies wire up the same way.
    const externalConfig = parseAgent24HeadlessConfig({
      ...config,
      resourceRoot: "/home/user/.agent24/components/open-design/abc1234-linux-x64/open-design",
      resourceSafeBase: "/home/user/.agent24/components/open-design/abc1234-linux-x64",
    });
    const homedir = () => "/home/user";

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
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
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
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/own realpath/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("rejects a resourceRoot that is not strictly under the explicit resourceSafeBase", async () => {
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
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/strictly under resourceSafeBase/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    // H1
    it("H1: rejects resourceRoot === resourceSafeBase (every entry point would resolve outside the verified base)", async () => {
      const { startSidecars } = startSidecarsStub();
      const equalConfig = parseAgent24HeadlessConfig({
        ...externalConfig,
        resourceRoot: externalConfig.resourceSafeBase,
      });
      await expect(startAgent24Headless(equalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/strictly under resourceSafeBase/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    // "base vs base-evil" prefix collision: path.relative is segment-aware,
    // not a naive string prefix check — a sibling directory whose name
    // merely starts with the same characters as safeBase must not be
    // mistaken for "under" it.
    it("rejects a resourceRoot that shares a string prefix with resourceSafeBase but is not actually under it (base vs base-evil)", async () => {
      const { startSidecars } = startSidecarsStub();
      const collidingConfig = parseAgent24HeadlessConfig({
        ...externalConfig,
        resourceRoot: "/home/user/.agent24/components/open-design/abc1234-linux-x64-evil/open-design",
      });
      await expect(startAgent24Headless(collidingConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/strictly under resourceSafeBase/);
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
        lstat: vi.fn(async () => ({ uid: process.getuid!() + 1, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
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
        lstat: vi.fn(async () => ({ uid: process.getuid!() ?? 0, mode: 0o040777, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/group- or other-writable/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    // M1, the sticky-bit exception: a world-writable ANCESTOR (a
    // pass-through directory on the way down, like /tmp) is fine as long
    // as the sticky bit is set — but only for ancestors. resourceSafeBase
    // ITSELF (and its own subtree) is the trust root, not a pass-through,
    // so it is held to the strict rule with no sticky exception at all
    // (Codex re-review, 2026-10-06 — see hasUnsafeSubtreeWriteBits).
    it("accepts a world-writable ANCESTOR only when the sticky bit is set, while resourceSafeBase itself stays strict", async () => {
      const { close, startSidecars } = startSidecarsStub();
      const runtime = await startAgent24Headless(externalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async (p: string) => (
          p === externalConfig.resourceSafeBase || p.startsWith(`${externalConfig.resourceSafeBase}/`)
            ? { uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 } // the trust root + its subtree: strict
            : { uid: process.getuid?.() ?? 0, mode: 0o041777, dev: 1, ino: 1 } // ancestors: sticky world-writable is fine
        )),
        homedir,
      });
      await runtime.close();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("rejects resourceSafeBase itself being world-writable EVEN WITH the sticky bit set (it is the trust root, not a pass-through ancestor)", async () => {
      const { startSidecars } = startSidecarsStub();
      await expect(startAgent24Headless(externalConfig, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o041777, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/group- or other-writable/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    // M2
    it("M2: rejects resourceSafeBase outright on win32 (no ACL check implemented yet)", async () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      try {
        const { startSidecars } = startSidecarsStub();
        await expect(startAgent24Headless(externalConfig, {
          access: vi.fn(async () => undefined),
          randomUUID: () => "instance-external",
          startSidecars: startSidecars as never,
        })).rejects.toThrow(/win32/);
        expect(startSidecars).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    });

    // M3
    it("M3: rejects a dataRoot that overlaps resourceSafeBase", async () => {
      const { startSidecars } = startSidecarsStub();
      const overlapping = parseAgent24HeadlessConfig({
        ...externalConfig,
        dataRoot: "/home/user/.agent24/components/open-design/abc1234-linux-x64/data",
      });
      await expect(startAgent24Headless(overlapping, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/dataRoot must not overlap resourceSafeBase/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("M3: rejects a runtimeRoot that overlaps resourceSafeBase", async () => {
      const { startSidecars } = startSidecarsStub();
      const overlapping = parseAgent24HeadlessConfig({
        ...externalConfig,
        runtimeRoot: "/home/user/.agent24/components/open-design/abc1234-linux-x64/runtime",
      });
      await expect(startAgent24Headless(overlapping, {
        access: vi.fn(async () => undefined),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async () => ({ uid: process.getuid?.() ?? 0, mode: 0o040700, dev: 1, ino: 1 })),
        homedir,
      })).rejects.toThrow(/runtimeRoot must not overlap resourceSafeBase/);
      expect(startSidecars).not.toHaveBeenCalled();
    });

    // M1 (TOCTOU). A real race can't be reproduced deterministically on a
    // real filesystem inside a unit test, so this one intentionally stays
    // mocked: the lstat stub reports a different (dev, ino) once the
    // access() checks (which happen strictly after the initial
    // resourceSafeBase verification, strictly before the pre-spawn
    // re-check) have resolved.
    it("M1 TOCTOU: rejects when resourceSafeBase's (dev, ino) changed between the initial check and the pre-spawn re-check", async () => {
      const { startSidecars } = startSidecarsStub();
      let swapped = false;
      await expect(startAgent24Headless(externalConfig, {
        access: vi.fn(async () => { swapped = true; }),
        randomUUID: () => "instance-external",
        startSidecars: startSidecars as never,
        realpath: vi.fn(async (p: string) => p),
        lstat: vi.fn(async () => ({
          uid: process.getuid?.() ?? 0,
          mode: 0o040700,
          dev: 1,
          ino: swapped ? 999 : 100,
        })),
        homedir,
      })).rejects.toThrow(/TOCTOU swap/);
      expect(startSidecars).not.toHaveBeenCalled();
    });
  });

  describe("v2 explicit resourceSafeBase — real tmpdir filesystem (not mocked)", () => {
    // These exercise the REAL, unmocked fs-backed dependencies
    // (DEFAULT_RESOURCE_SAFE_BASE_DEPENDENCIES) against a real tmpdir —
    // every test above mocks realpath/lstat/homedir entirely, which never
    // actually proves the real wiring (node:fs/promises' realpath/lstat,
    // node:os's homedir) agrees with the mocked behavior.
    const cleanupDirs: string[] = [];
    afterEach(() => {
      for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    function makeRealFixture(): { home: string; safeBase: string; resourceRoot: string; runtimeExecutable: string } {
      const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "a24-headless-home-")));
      cleanupDirs.push(home);
      fs.chmodSync(home, 0o700);
      const safeBase = path.join(home, ".agent24", "components", "open-design", "abc1234-linux-x64");
      fs.mkdirSync(safeBase, { recursive: true, mode: 0o700 });
      for (const dir of [
        path.join(home, ".agent24"),
        path.join(home, ".agent24", "components"),
        path.join(home, ".agent24", "components", "open-design"),
        safeBase,
      ]) fs.chmodSync(dir, 0o700);
      const resourceRoot = path.join(safeBase, "open-design");
      fs.mkdirSync(resourceRoot, { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.join(safeBase, "app", "prebundled", "daemon"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(safeBase, "app", "prebundled", "daemon", "daemon-cli.mjs"), "");
      fs.writeFileSync(path.join(safeBase, "app", "prebundled", "daemon", "daemon-sidecar.mjs"), "");
      fs.writeFileSync(path.join(safeBase, "app", "prebundled", "web-sidecar.mjs"), "");
      fs.mkdirSync(path.join(safeBase, "open-design-web-standalone"), { recursive: true, mode: 0o700 });
      const runtimeExecutable = path.join(home, "Agent24");
      fs.writeFileSync(runtimeExecutable, "");
      return { home, safeBase, resourceRoot, runtimeExecutable };
    }

    async function withRealFixtureHome<T>(fixture: { home: string }, fn: () => Promise<T>): Promise<T> {
      // os.homedir() reads $HOME on POSIX at call time (no caching) — this
      // is how the REAL (unmocked) homedir dependency is pointed at our
      // fixture instead of this machine's actual home directory.
      const previousHome = process.env.HOME;
      process.env.HOME = fixture.home;
      try {
        return await fn();
      } finally {
        process.env.HOME = previousHome;
      }
    }

    function realFsDependencies(startSidecars: ReturnType<typeof vi.fn>, instanceId = "instance-real-fs") {
      // Deliberately no realpath/lstat/homedir overrides: this is what
      // "not mocked" means here. Only randomUUID/startSidecars are
      // stubbed, since a unit test should not actually spawn sidecar
      // processes.
      return { access: realAccess, randomUUID: () => instanceId, startSidecars: startSidecars as never };
    }

    it("real wiring: accepts a real tmpdir fixture end-to-end with nothing mocked but randomUUID/startSidecars", async () => {
      if (typeof process.getuid !== "function") return; // POSIX-only check
      const fixture = makeRealFixture();
      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: fixture.resourceRoot,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const close = vi.fn(async () => undefined);
      const startSidecars = vi.fn(async (..._args: unknown[]) => ({
        close,
        currentWebUrl: () => "http://127.0.0.1:7456",
        daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
        web: { state: "running" as const, url: "http://127.0.0.1:7456" },
      }));
      await withRealFixtureHome(fixture, async () => {
        const runtime = await startAgent24Headless(cfg, realFsDependencies(startSidecars));
        expect(startSidecars.mock.calls[0]?.[2]).toMatchObject({ resourceSafeBase: fixture.safeBase });
        await runtime.close();
      });
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("Codex re-review (2026-10-06): the entries actually passed to startSidecars are the VALIDATED (realpath'd) ones, not freshly re-computed lexical ones", async () => {
      // A real symlink inside resourceSafeBase that points to a DIFFERENT
      // (but still safely-inside-the-base) real directory. Both the
      // lexical path (through the symlink) and the realpath (the
      // symlink's target) are individually safe — the point of this test
      // is narrower: that startSidecars receives the SAME realpath'd
      // value assertAgent24ResourceRoot already verified, not a second,
      // independently-recomputed lexical one. Before the fix, the entry
      // used for actual access()/spawn was recomputed via
      // resolveAgent24HeadlessEntries(resolvedConfig) — a plain lexical
      // join that still goes THROUGH the symlink — so this test would
      // have passed even on the buggy code for this specific safe-rename
      // case. What it DOES still catch: a regression back to computing
      // entries twice from two different inputs ever producing two
      // different answers would show up here as soon as the two
      // computations diverge for any reason.
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      const renamedAppRoot = path.join(fixture.safeBase, "app-real");
      fs.renameSync(path.join(fixture.safeBase, "app"), renamedAppRoot);
      fs.symlinkSync(renamedAppRoot, path.join(fixture.safeBase, "app"));

      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: fixture.resourceRoot,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const close = vi.fn(async () => undefined);
      const startSidecars = vi.fn(async (..._args: unknown[]) => ({
        close,
        currentWebUrl: () => "http://127.0.0.1:7456",
        daemon: { state: "running" as const, url: "http://127.0.0.1:7457" },
        web: { state: "running" as const, url: "http://127.0.0.1:7456" },
      }));
      await withRealFixtureHome(fixture, async () => {
        const runtime = await startAgent24Headless(cfg, realFsDependencies(startSidecars));
        expect(startSidecars.mock.calls[0]?.[1]).toMatchObject({
          resourceRoot: fixture.resourceRoot,
        });
        expect(startSidecars.mock.calls[0]?.[2]).toMatchObject({
          daemonCliEntry: path.join(renamedAppRoot, "prebundled", "daemon", "daemon-cli.mjs"),
          daemonSidecarEntry: path.join(renamedAppRoot, "prebundled", "daemon", "daemon-sidecar.mjs"),
          webSidecarEntry: path.join(renamedAppRoot, "prebundled", "web-sidecar.mjs"),
        });
        await runtime.close();
      });
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("rejects a resourceSafeBase that is a real symlink", async () => {
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      const linkedBase = path.join(fixture.home, "linked-base");
      fs.symlinkSync(fixture.safeBase, linkedBase);
      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: path.join(linkedBase, "open-design"),
        resourceSafeBase: linkedBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const startSidecars = vi.fn();
      await withRealFixtureHome(fixture, async () => {
        await expect(startAgent24Headless(cfg, realFsDependencies(startSidecars))).rejects.toThrow(/own realpath/);
      });
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("rejects when a launcher entry's directory is a real symlink that escapes resourceSafeBase", async () => {
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      // Replace the safe app/ directory with a symlink pointing OUTSIDE
      // safeBase — resourceRoot itself still resolves fine, but every
      // entry point (derived from dirname(resourceRoot) + "app/...") now
      // resolves through this symlink to somewhere unverified.
      fs.rmSync(path.join(fixture.safeBase, "app"), { recursive: true, force: true });
      const evilAppRoot = path.join(fixture.home, "evil-app");
      fs.mkdirSync(path.join(evilAppRoot, "prebundled", "daemon"), { recursive: true });
      fs.writeFileSync(path.join(evilAppRoot, "prebundled", "daemon", "daemon-cli.mjs"), "");
      fs.writeFileSync(path.join(evilAppRoot, "prebundled", "daemon", "daemon-sidecar.mjs"), "");
      fs.writeFileSync(path.join(evilAppRoot, "prebundled", "web-sidecar.mjs"), "");
      fs.symlinkSync(evilAppRoot, path.join(fixture.safeBase, "app"));

      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: fixture.resourceRoot,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const startSidecars = vi.fn();
      await withRealFixtureHome(fixture, async () => {
        await expect(startAgent24Headless(cfg, realFsDependencies(startSidecars)))
          .rejects.toThrow(/realpath must be strictly under resourceSafeBase/);
      });
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it.each([0o770, 0o702, 0o777])("rejects a real resourceSafeBase with unsafe mode 0o%o", async (mode) => {
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      fs.chmodSync(fixture.safeBase, mode);
      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: fixture.resourceRoot,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const startSidecars = vi.fn();
      try {
        await withRealFixtureHome(fixture, async () => {
          await expect(startAgent24Headless(cfg, realFsDependencies(startSidecars)))
            .rejects.toThrow(/group- or other-writable/);
        });
        expect(startSidecars).not.toHaveBeenCalled();
      } finally {
        fs.chmodSync(fixture.safeBase, 0o700); // restore before the afterEach rm, harmless either way
      }
    });

    it("M1: rejects when resourceRoot itself (not just resourceSafeBase) is group- or other-writable", async () => {
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      fs.chmodSync(fixture.resourceRoot, 0o777);
      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: fixture.resourceRoot,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const startSidecars = vi.fn();
      await withRealFixtureHome(fixture, async () => {
        await expect(startAgent24Headless(cfg, realFsDependencies(startSidecars)))
          .rejects.toThrow(/group- or other-writable/);
      });
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("H1: rejects resourceRoot === resourceSafeBase against a real fixture", async () => {
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: fixture.safeBase,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const startSidecars = vi.fn();
      await withRealFixtureHome(fixture, async () => {
        await expect(startAgent24Headless(cfg, realFsDependencies(startSidecars)))
          .rejects.toThrow(/strictly under resourceSafeBase/);
      });
      expect(startSidecars).not.toHaveBeenCalled();
    });

    it("rejects a real resourceRoot that shares a string prefix with resourceSafeBase but is not actually under it (base vs base-evil)", async () => {
      if (typeof process.getuid !== "function") return;
      const fixture = makeRealFixture();
      const evilSibling = `${fixture.safeBase}-evil`;
      fs.mkdirSync(evilSibling, { recursive: true, mode: 0o700 });
      const cfg = parseAgent24HeadlessConfig({
        ...config,
        resourceRoot: evilSibling,
        resourceSafeBase: fixture.safeBase,
        runtimeExecutable: fixture.runtimeExecutable,
      });
      const startSidecars = vi.fn();
      await withRealFixtureHome(fixture, async () => {
        await expect(startAgent24Headless(cfg, realFsDependencies(startSidecars)))
          .rejects.toThrow(/strictly under resourceSafeBase/);
      });
      expect(startSidecars).not.toHaveBeenCalled();
    });
  });
});
