import type { IncomingHttpHeaders } from "node:http";

/**
 * Must stay equal to `AGENT24_HEADLESS_NAMESPACE` in
 * `apps/packaged/src/agent24-headless.ts`. Headless copies that value onto
 * the web sidecar stamp (`packagedChildStamp` → `client.stamp.namespace`).
 * Upstream headless uses mode `"headless"` too, so mode alone is not the
 * Agent24 shell.
 */
export const AGENT24_HEADLESS_NAMESPACE = "agent24-creative";

const AGENT24_SHELL_BOOT_MARK = "data-od-agent24-shell";
const AGENT24_SHELL_BOOT_SCRIPT =
  `<script ${AGENT24_SHELL_BOOT_MARK}>globalThis.__OD_IS_AGENT24__=true</script>`;

export function isAgent24HeadlessNamespace(namespace: string | null | undefined): boolean {
  return namespace === AGENT24_HEADLESS_NAMESPACE;
}

export function isAgent24DocumentRequest(input: {
  method: string | undefined;
  accept: string | string[] | undefined;
  pathname: string;
}): boolean {
  const method = (input.method ?? "GET").toUpperCase();
  if (method !== "GET") return false;
  if (input.pathname.startsWith("/_next/")) return false;
  const accept = Array.isArray(input.accept) ? input.accept.join(",") : input.accept ?? "";
  if (accept.length > 0 && !accept.toLowerCase().includes("text/html")) return false;
  return true;
}

export function injectAgent24ShellBoot(html: string): string {
  if (html.includes(AGENT24_SHELL_BOOT_MARK)) return html;
  const match = /<head\b[^>]*>/i.exec(html);
  if (match?.index == null) return `${AGENT24_SHELL_BOOT_SCRIPT}${html}`;
  const at = match.index + match[0].length;
  return `${html.slice(0, at)}${AGENT24_SHELL_BOOT_SCRIPT}${html.slice(at)}`;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(",") : value ?? "";
}

/**
 * 1xx, 204, and 304 must not grow a message body. A prerendered page's
 * conditional GET is a real 304 whose Content-Length describes the selected
 * representation, not a payload we are allowed to replace.
 */
export function agent24ShellStatusOmitsBody(statusCode: number): boolean {
  return statusCode < 200 || statusCode === 204 || statusCode === 304;
}

export function rewriteAgent24ShellDocument(
  headers: IncomingHttpHeaders,
  body: Buffer,
  statusCode = 200,
): { headers: IncomingHttpHeaders; body: Buffer } | null {
  if (agent24ShellStatusOmitsBody(statusCode) || body.length === 0) return null;
  const type = headerValue(headers["content-type"]).toLowerCase();
  if (!type.includes("text/html")) return null;
  const encoding = headerValue(headers["content-encoding"]).trim().toLowerCase();
  if (encoding.length > 0 && encoding !== "identity") return null;
  const next = Buffer.from(injectAgent24ShellBoot(body.toString("utf8")), "utf8");
  const rewritten: IncomingHttpHeaders = { ...headers };
  delete rewritten["content-encoding"];
  delete rewritten["transfer-encoding"];
  rewritten["content-length"] = String(next.length);
  return { headers: rewritten, body: next };
}
