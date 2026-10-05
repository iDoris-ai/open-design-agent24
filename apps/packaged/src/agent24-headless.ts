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
//
// KNOWN, DEFERRED LIMITATIONS (Codex re-review round 3, 2026-10-06 —
// tracked here rather than silently left unmentioned; fixing either
// properly means touching files outside this one):
//  1. sidecars.ts's own log-opening code (openLog() and friends) opens
//     files under subdirectories of logsRoot/desktopLogsRoot this module
//     never individually re-validates (only the roots themselves are
//     overlap-checked, not every per-app descendant actually opened at
//     runtime) — a symlink planted at exactly the right descendant path
//     (e.g. logsRoot/daemon) could still redirect a log write into
//     resourceSafeBase without tripping anything here. Properly closing
//     this means validating at the point sidecars.ts actually opens each
//     file, not just validating the configured roots up front.
//  2. This module and apps/daemon/src/daemon-paths.ts can each apply
//     their own normalization (e.g. whitespace trimming) to the same
//     configured path independently — if they ever disagree, this module
//     could validate one exact string while the daemon consumes a
//     different (but overlapping) one. Properly closing this means both
//     sides sharing one normalization step before either validates or
//     consumes a path, not each re-deriving its own.
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
// Codex re-review round 2 (2026-10-06): `rel.startsWith("..")` matches
// not just a real ".." parent-traversal segment but also any sibling
// whose name happens to start with those two characters — "..bundle" is
// a perfectly legitimate directory NAME, and path.relative("/trusted",
// "/trusted/..bundle") returns the single segment "..bundle", which the
// naive startsWith check wrongly treated as an escape. A real
// parent-traversal is either exactly ".." or starts with ".." followed
// by a path separator — never just those two characters as a prefix of a
// longer name.
function escapesSafeBase(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`);
}

function isUnderSafeBase(safeBase: string, candidate: string): boolean {
  const rel = relative(safeBase, candidate);
  return rel === "" || (!escapesSafeBase(rel) && !isAbsolute(rel));
}

function isStrictlyUnderSafeBase(safeBase: string, candidate: string): boolean {
  const rel = relative(safeBase, candidate);
  return rel !== "" && !escapesSafeBase(rel) && !isAbsolute(rel);
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

// M1 (Opus re-review round 2 / Codex, 2026-10-06): sticky-bit directories
// (e.g. /tmp, mode 1777) are the standard safe exception to "group/other
// writable" when they are merely a PASS-THROUGH ancestor on the way down
// to resourceSafeBase — the sticky bit stops anyone but a file's own
// owner from renaming or removing an EXISTING entry inside such a
// directory, which is the property that matters for "can someone swap
// out the next path segment". Two things Codex correctly flagged this
// did NOT account for:
//  - Sticky has no defined meaning for a non-directory. A `.mjs` file
//    with mode 01666 is fully group/other-writable; its own sticky bit
//    does nothing to stop that. The exception below is gated on
//    `isDirectory` for exactly this reason.
//  - resourceSafeBase ITSELF, resourceRoot, and every launcher entry
//    point are not "pass-through" — they ARE the trust root and what
//    gets executed. A world-writable resourceSafeBase/resourceRoot/entry
//    is unsafe even with a sticky bit (sticky still lets anyone CREATE a
//    new child there, which matters when the child's own name is exactly
//    what we're about to trust). hasUnsafeSubtreeWriteBits below allows
//    no exception at all; only the ancestor-chain walk uses the sticky
//    exception.
function hasUnsafeAncestorWriteBits(mode: number, isDirectory: boolean): boolean {
  if (isDirectory && (mode & 0o1000) !== 0) return false;
  return (mode & 0o022) !== 0;
}

function hasUnsafeSubtreeWriteBits(mode: number): boolean {
  return (mode & 0o022) !== 0;
}

// Only called once the caller has confirmed process.platform !== "win32"
// (see the M2 check in assertAgent24ResourceRoot), so process.getuid is
// always available here.
function ownerIsTrusted(uid: number): boolean {
  return uid === process.getuid!() || uid === 0;
}

type LstatResult = { uid: number; mode: number; dev: number; ino: number };

async function assertAncestorPathIsSafe(
  targetPath: string,
  dependencies: Required<Pick<ResourceSafeBaseDependencies, "lstat">>,
): Promise<LstatResult> {
  const info = await dependencies.lstat(targetPath);
  if (!ownerIsTrusted(info.uid)) {
    throw new Error(`agent24-headless config resourceSafeBase ancestor is not owned by the current user or root: ${targetPath}`);
  }
  // S_IFDIR = 0o040000; lstat's mode packs the file-type bits in the high
  // bits alongside the permission bits this function otherwise only reads
  // the low 12 of.
  const isDirectory = (info.mode & 0o170000) === 0o040000;
  if (hasUnsafeAncestorWriteBits(info.mode, isDirectory)) {
    throw new Error(`agent24-headless config resourceSafeBase ancestor is group- or other-writable without the sticky bit: ${targetPath}`);
  }
  return info;
}

async function assertSubtreePathIsSafe(
  targetPath: string,
  dependencies: Required<Pick<ResourceSafeBaseDependencies, "lstat">>,
): Promise<LstatResult> {
  const info = await dependencies.lstat(targetPath);
  if (!ownerIsTrusted(info.uid)) {
    throw new Error(`agent24-headless config resourceSafeBase subtree path is not owned by the current user or root: ${targetPath}`);
  }
  if (hasUnsafeSubtreeWriteBits(info.mode)) {
    throw new Error(`agent24-headless config resourceSafeBase subtree path is group- or other-writable: ${targetPath}`);
  }
  return info;
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

// M1 (Codex, 2026-10-06): the filesystem root itself ("/") is now included
// as the first element — it was silently skipped before. $HOME is NOT a
// trusted anchor to start from: HOME's own parent (and every ancestor
// above it) can just as easily be replaced/hijacked as any other level,
// and an attacker-influenced HOME environment variable could otherwise
// shorten the checked chain arbitrarily. Always walking from the real
// filesystem root removes both problems — it costs a handful of extra
// lstat calls (/, /Users, /home, etc. are cheap and, in every real
// deployment, root-owned with no write bits anyway).
function rootToTargetChain(target: string): string[] {
  const segments = target.split(sep).filter((segment) => segment.length > 0);
  const chain: string[] = [sep];
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
// chain from the filesystem root down to resourceSafeBase (sticky bit
// excepted — these are pass-through directories like /tmp or /Users),
// plus resourceSafeBase's own subtree down to resourceRoot and each
// launcher entry point (no sticky exception there — see
// hasUnsafeSubtreeWriteBits above). Returns every (dev, ino) it looked at,
// keyed by path, so the caller can later re-check the exact same set
// right before spawning anything (see the TOCTOU re-check in
// assertAgent24ResourceRoot's returned verify()).
async function assertResourceSafeBaseAncestryIsSafe(
  safeBase: string,
  subtreeTargets: readonly string[],
  dependencies: Required<Pick<ResourceSafeBaseDependencies, "lstat">>,
): Promise<Map<string, LstatResult>> {
  const snapshots = new Map<string, LstatResult>();
  const ancestorChain = rootToTargetChain(safeBase);
  for (const target of ancestorChain) {
    // The LAST element of ancestorChain is safeBase itself — it belongs to
    // the strict (no sticky exception) subtree rule, not the ancestor
    // rule, since it IS the trust root rather than a pass-through on the
    // way to it.
    const isSafeBaseItself = target === safeBase;
    const info = isSafeBaseItself
      ? await assertSubtreePathIsSafe(target, dependencies)
      : await assertAncestorPathIsSafe(target, dependencies);
    snapshots.set(target, info);
  }
  const subtreeChains = subtreeTargets.flatMap((target) => chainFromAncestor(safeBase, target));
  for (const target of subtreeChains) {
    if (snapshots.has(target)) continue;
    snapshots.set(target, await assertSubtreePathIsSafe(target, dependencies));
  }
  return snapshots;
}

// M3 helper: dataRoot/runtimeRoot are typically created by a LATER step
// (resolveAgent24HeadlessPaths's consumers, or startPackagedSidecars
// itself) — a bare realpath() on a path that doesn't exist yet throws.
// Walk up until an existing ancestor is found, realpath THAT, then
// re-append the not-yet-created suffix lexically (safe: a path segment
// that doesn't exist yet cannot be a symlink).
// Codex re-review round 2 (2026-10-06): the original version caught EVERY
// realpath() error and treated it as "this path segment doesn't exist
// yet", silently continuing to climb. That is only correct for ENOENT. A
// dangling symlink (the entry itself EXISTS — lstat succeeds — but what
// it points at doesn't, so realpath() throws ENOENT on the TARGET, not on
// the entry's own absence) would be wrongly reconstructed as a plain,
// not-yet-created path segment. EACCES/ELOOP are not "missing" either —
// silently climbing past those risks validating against the wrong
// directory entirely. Only treat a segment as genuinely absent when
// lstat() on it ALSO throws ENOENT (confirms nothing exists there, not
// even a broken symlink); anything else fails closed.
interface NearestExistingAncestorResult {
  /** The fully-resolved existing ancestor's realpath, with the
   * not-yet-created suffix (if any) re-appended lexically. This is what
   * the overlap containment check compares against safeBase. */
  path: string;
  /** The existing ancestor's OWN realpath, with no suffix re-appended —
   * i.e. an actual, lstat-able filesystem object right now. Codex
   * re-review round 3 (2026-10-06): the overlap check's conclusion is
   * only valid for as long as THIS object stays what it was when
   * checked; the caller snapshots it so verify() can catch it being
   * swapped out later. */
  existingAncestor: string;
}

async function realpathOfNearestExistingAncestor(
  target: string,
  doRealpath: (path: string) => Promise<string>,
  doLstat: (path: string) => Promise<unknown>,
): Promise<NearestExistingAncestorResult> {
  let current = target;
  let suffix = "";
  for (;;) {
    try {
      const resolved = await doRealpath(current);
      return { path: suffix === "" ? resolved : join(resolved, suffix), existingAncestor: resolved };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "ENOENT") {
        throw new Error(`agent24-headless config could not resolve ${current} while checking ${target} for overlap: ${String(error)}`);
      }
      let existsButUnresolvable = true;
      try {
        await doLstat(current);
      } catch (lstatError) {
        const lstatCode = (lstatError as { code?: string } | null)?.code;
        if (lstatCode === "ENOENT") existsButUnresolvable = false;
        else throw lstatError;
      }
      if (existsButUnresolvable) {
        // lstat succeeded (or threw something other than ENOENT) while
        // realpath failed with ENOENT: current exists (e.g. a dangling
        // symlink whose TARGET is missing) — this is not "not created
        // yet", it's an existing, unexpected object. Fail closed rather
        // than silently walking past it.
        throw new Error(`agent24-headless config found an existing but unresolvable path while checking ${target} for overlap: ${current}`);
      }
      const parent = dirname(current);
      if (parent === current) throw new Error(`unable to resolve any existing ancestor of ${target}`);
      suffix = suffix === "" ? basename(current) : join(basename(current), suffix);
      current = parent;
    }
  }
}

async function assertAgent24ResourceRoot(
  config: Agent24HeadlessConfig,
  dependencies: ResourceSafeBaseDependencies = DEFAULT_RESOURCE_SAFE_BASE_DEPENDENCIES,
): Promise<{
  resourceSafeBase: string;
  resourceRoot: string;
  resolvedEntries: ReturnType<typeof resolveAgent24HeadlessEntries>;
  verify(): Promise<void>;
}> {
  if (config.resourceSafeBase == null) {
    // v1-compatible fallback: unchanged derivation + lexical containment
    // check, no realpath, no ownership/mode checks. A host that never
    // adopts resourceSafeBase keeps working exactly as before.
    const safeBase = resolveAgent24ResourceSafeBase(config.runtimeExecutable);
    if (!isUnderSafeBase(safeBase, config.resourceRoot)) {
      throw new Error("agent24-headless config resourceRoot must be under the packaged resources directory");
    }
    return {
      resourceSafeBase: safeBase,
      resourceRoot: config.resourceRoot,
      resolvedEntries: resolveAgent24HeadlessEntries(config),
      verify: async () => {},
    };
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

  // M3 (Codex, 2026-10-06): the writable state tree must never overlap the
  // (host-enforced read-only, per Agent24's installer) resource tree —
  // otherwise a compromised sidecar writing into its own state dir could
  // write INTO the trusted resource tree. Checking only dataRoot/
  // runtimeRoot missed every path DERIVED from them (logsRoot, cacheRoot,
  // electronUserDataRoot, ...) — sidecars.ts writes directly into several
  // of those, not just the two raw config fields. Check every writable
  // field resolveAgent24HeadlessPaths derives (everything except
  // resourceRoot itself, which is expected to relate to the resource
  // tree). realpath each candidate first (falling back to the nearest
  // EXISTING ancestor's realpath, re-appending the not-yet-created
  // suffix, since most of these are created by a later step and a bare
  // realpath() on a path that doesn't exist yet would throw) and check
  // containment in BOTH directions — neither may be nested inside the
  // other.
  // Codex re-review round 3 (2026-10-06): the overlap conclusion below is
  // only sound for as long as each candidate's existing ancestor stays
  // what it was when checked — record it (via assertSubtreePathIsSafe,
  // which also lstat's it into writableAncestorSnapshots below) so
  // verify() can catch a later swap into resourceSafeBase. This narrows,
  // but does not fully close, the real remaining race Codex demonstrated
  // (the ancestor can still be swapped to something INSIDE
  // resourceSafeBase in the instant between this lstat and the time
  // startSidecars actually begins using it) — fully closing that would
  // need to re-run this entire overlap check again inside verify(),
  // which is deferred as a follow-up rather than done here.
  const derivedPaths = resolveAgent24HeadlessPaths({ ...config, resourceRoot: resolvedResourceRoot });
  const writableAncestorSnapshots = new Map<string, LstatResult>();
  for (const [field, rawCandidate] of Object.entries(derivedPaths)) {
    if (field === "resourceRoot") continue;
    const { path: candidate, existingAncestor } = await realpathOfNearestExistingAncestor(rawCandidate, deps.realpath, deps.lstat);
    if (isUnderSafeBase(safeBase, candidate) || isUnderSafeBase(candidate, safeBase)) {
      throw new Error(`agent24-headless config ${field} must not overlap resourceSafeBase`);
    }
    if (!writableAncestorSnapshots.has(existingAncestor)) {
      writableAncestorSnapshots.set(existingAncestor, await deps.lstat(existingAncestor));
    }
  }

  // M1: ownership/writability all the way from the filesystem root down
  // to resourceSafeBase, and from resourceSafeBase down to resourceRoot
  // and every entry point. Reuses these same lstat results as the TOCTOU
  // baseline below instead of taking a separate, later snapshot — Codex
  // correctly flagged that a fresh lstat taken AFTER all the checks above
  // have their own (now-discarded) lstat results opens exactly the kind
  // of swap window this whole mechanism exists to close.
  const verifiedTargets = [safeBase, resolvedResourceRoot, ...Object.values(resolvedEntries)];
  const snapshots = await assertResourceSafeBaseAncestryIsSafe(safeBase, verifiedTargets, deps);
  // Fold in the M3 writable-path ancestors snapshotted above so verify()
  // re-checks those too, not just the resourceSafeBase side of the trust
  // boundary.
  for (const [path, info] of writableAncestorSnapshots) {
    if (!snapshots.has(path)) snapshots.set(path, info);
  }

  return {
    resourceSafeBase: safeBase,
    resourceRoot: resolvedResourceRoot,
    resolvedEntries,
    // M1 (TOCTOU). Codex re-review round 2 (2026-10-06) correctly flagged
    // two gaps in the previous version: it only re-checked the endpoints
    // (verifiedTargets), skipping every INTERMEDIATE ancestor/subtree
    // directory the Map below also recorded; and it only compared
    // (dev, ino), which stays unchanged if an attacker chmod/chown's the
    // SAME inode in place rather than swapping it for a different one.
    // Fixed: re-lstat and re-verify EVERY path this whole check looked
    // at — the full ancestor chain and subtree, not just the endpoints —
    // and reject on ANY difference from what was recorded (dev, ino, uid,
    // or mode), not just a changed inode. Still not a complete close of
    // every TOCTOU window: `dependencies.startSidecars` itself runs
    // further async steps after this (directory creation, sidecar
    // prewarming, the daemon becoming ready before the web sidecar even
    // starts, and any later restart of either) during which nothing
    // re-verifies anything, and this function's own sequential awaits
    // over many paths are themselves not atomic. Fully eliminating that
    // would need opening these paths once and executing from the
    // resulting file descriptors rather than by path again later — out
    // of scope for this change; documented here as a known, accepted
    // residual gap rather than silently pretending this closes it
    // completely.
    async verify() {
      for (const [target, expected] of snapshots) {
        const current = await deps.lstat(target);
        if (
          current.dev !== expected.dev
          || current.ino !== expected.ino
          || current.uid !== expected.uid
          || current.mode !== expected.mode
        ) {
          throw new Error(`agent24-headless config path changed after it was verified (possible TOCTOU swap): ${target}`);
        }
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
  // Codex (2026-10-06): this used to call resolveAgent24HeadlessEntries(
  // resolvedConfig) again here, discarding the realpath'd+verified
  // entries assertAgent24ResourceRoot just computed and checked, and using
  // freshly-recomputed LEXICAL ones instead — a symlink inside
  // resourceRoot's own subtree (e.g. the "app" directory itself) could
  // resolve its entries outside resourceSafeBase despite having just been
  // rejected by that exact check, because the entries actually used for
  // access()/spawn were never the ones that check validated. Reuse the
  // already-verified resolvedEntries directly instead of recomputing.
  const entries = resolved.resolvedEntries;
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
