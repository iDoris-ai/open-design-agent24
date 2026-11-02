import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import vm from 'node:vm';

import {
  AGENT24_HEADLESS_NAMESPACE,
  injectAgent24ShellBoot,
  isAgent24DocumentRequest,
  isAgent24HeadlessNamespace,
  rewriteAgent24ShellDocument,
} from '../sidecar/agent24-shell';
import { proxyHttpRequest } from '../sidecar/server';
import { isAgent24Shell } from '../src/runtime/agent24-shell';

const servers: Server[] = [];

afterEach(async () => {
  delete (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__;
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error == null ? resolve() : reject(error)));
    });
  }));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('agent24 shell flag', () => {
  it('matches the namespace agent24-headless stamps onto the web sidecar', () => {
    const packaged = readFileSync(
      new URL('../../packaged/src/agent24-headless.ts', import.meta.url),
      'utf8',
    );
    const sidecarIndex = readFileSync(new URL('../sidecar/index.ts', import.meta.url), 'utf8');
    expect(packaged).toContain(
      `export const AGENT24_HEADLESS_NAMESPACE = "${AGENT24_HEADLESS_NAMESPACE}";`,
    );
    expect(packaged).toContain('namespace: AGENT24_HEADLESS_NAMESPACE');
    expect(packaged).toContain('webOutputMode: "standalone"');
    expect(sidecarIndex).toContain('namespace: client.stamp.namespace');
    expect(isAgent24HeadlessNamespace(AGENT24_HEADLESS_NAMESPACE)).toBe(true);
    expect(isAgent24HeadlessNamespace('default')).toBe(false);
    expect(isAgent24HeadlessNamespace('headless')).toBe(false);
    expect(isAgent24HeadlessNamespace('agent24-creative-extra')).toBe(false);
  });

  it('injects a head script that sets the client flag, and leaves other namespaces alone at the predicate', () => {
    const html = injectAgent24ShellBoot('<!doctype html><html><head><meta charset="utf-8"></head><body>ok</body></html>');
    expect(html.indexOf('data-od-agent24-shell')).toBeLessThan(html.indexOf('<body'));
    expect(injectAgent24ShellBoot(html)).toBe(html);
    const script = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
    const context = vm.createContext({});
    vm.runInContext(script, context);
    expect((context as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__).toBe(true);

    expect(isAgent24Shell()).toBe(false);
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
    expect(isAgent24Shell()).toBe(true);
  });

  it('rewrites only uncompressed html documents', () => {
    expect(isAgent24DocumentRequest({
      method: 'GET',
      accept: 'text/html,application/xhtml+xml',
      pathname: '/',
    })).toBe(true);
    expect(isAgent24DocumentRequest({
      method: 'GET',
      accept: 'text/x-component',
      pathname: '/',
    })).toBe(false);
    expect(isAgent24DocumentRequest({
      method: 'GET',
      accept: 'text/html',
      pathname: '/_next/static/app.js',
    })).toBe(false);

    const html = Buffer.from('<html><head></head><body>x</body></html>');
    const rewritten = rewriteAgent24ShellDocument({ 'content-type': 'text/html; charset=utf-8' }, html);
    expect(rewritten?.body.toString('utf8')).toContain('globalThis.__OD_IS_AGENT24__=true');
    expect(rewritten?.headers['content-length']).toBe(String(rewritten?.body.length));
    expect(rewriteAgent24ShellDocument(
      { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      html,
    )).toBeNull();
    expect(rewriteAgent24ShellDocument({ 'content-type': 'application/javascript' }, html)).toBeNull();
  });

  it('injects the boot script through the document proxy only for the agent24 shell', async () => {
    const seenEncoding: Array<string | undefined> = [];
    const upstreamOrigin = await listen(createServer((request, response) => {
      seenEncoding.push(request.headers['accept-encoding']);
      const body = '<!doctype html><html><head></head><body>shell</body></html>';
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
    }));

    async function proxy(agent24Shell: boolean): Promise<string> {
      const origin = await listen(createServer((request, response) => {
        const target = new URL(request.url ?? '/', upstreamOrigin);
        void proxyHttpRequest(target, request, response, { agent24Shell }).catch((error: unknown) => {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : String(error));
        });
      }));
      const response = await fetch(origin, {
        headers: {
          accept: 'text/html',
          'accept-encoding': 'gzip',
        },
      });
      return await response.text();
    }

    const hidden = await proxy(true);
    const shown = await proxy(false);
    expect(hidden).toContain('data-od-agent24-shell');
    expect(hidden).toContain('shell');
    expect(shown).not.toContain('data-od-agent24-shell');
    expect(shown).toContain('<body>shell</body>');
    expect(seenEncoding[0] ?? '').not.toMatch(/gzip/i);
    expect(seenEncoding[1]).toMatch(/gzip/i);
  });

  it('leaves the update dialog and design-files GitHub links in place', () => {
    const updateDialog = readFileSync(
      new URL('../src/components/UpdateDialog.tsx', import.meta.url),
      'utf8',
    );
    const designFiles = readFileSync(
      new URL('../src/components/DesignFilesPanel.tsx', import.meta.url),
      'utf8',
    );
    expect(updateDialog).toContain(
      "const RELEASES_URL = 'https://github.com/nexu-io/open-design/releases';",
    );
    expect(designFiles).toContain(
      "{ key: 'designFiles.usefulInfoTip7', url: 'https://github.com/nexu-io/open-design' }",
    );
    expect(designFiles).toContain('href={tipUrl}');
  });
});
