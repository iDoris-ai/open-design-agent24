/**
 * Agent24 product shell.
 *
 * `startAgent24Headless` stamps the web sidecar with namespace
 * `agent24-creative` (`AGENT24_HEADLESS_NAMESPACE` in
 * `apps/packaged/src/agent24-headless.ts`) and serves the app through the
 * standalone web sidecar. That sidecar injects a blocking head script which
 * sets this flag before the client app mounts (`App` is loaded with
 * `ssr: false`). Upstream namespaces never match, so the script is absent
 * and this stays false.
 */
export const AGENT24_HEADLESS_NAMESPACE = 'agent24-creative';

const AGENT24_SHELL_FLAG = '__OD_IS_AGENT24__';

type Agent24ShellGlobal = typeof globalThis & { [AGENT24_SHELL_FLAG]?: unknown };

export function isAgent24Shell(): boolean {
  return (globalThis as Agent24ShellGlobal)[AGENT24_SHELL_FLAG] === true;
}
