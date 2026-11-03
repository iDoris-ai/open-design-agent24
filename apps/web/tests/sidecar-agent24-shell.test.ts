import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import vm from 'node:vm';

import {
  AGENT24_HEADLESS_NAMESPACE,
  injectAgent24ShellBoot,
  isAgent24DocumentRequest,
  isAgent24HeadlessNamespace,
  rewriteAgent24ShellDocument,
} from '../sidecar/agent24-shell';
import { AGENT24_SHELL_HTML_BUFFER_LIMIT_BYTES, proxyHttpRequest } from '../sidecar/server';
import {
  AGENT24_HEADLESS_NAMESPACE as runtimeAgent24Namespace,
  isAgent24Shell,
} from '../src/runtime/agent24-shell';

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

function exportedConstString(source: string, name: string): string {
  const match = new RegExp(`export const ${name} = ['"]([^'"]+)['"]`).exec(source);
  if (match?.[1] == null) throw new Error(`source is missing export const ${name}`);
  return match[1];
}

function rawRequest(
  origin: string,
  init: { method?: string; headers?: IncomingHttpHeaders; path?: string; timeoutMs?: number } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  const url = new URL(init.path ?? '/', origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? 'GET',
      headers: init.headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
      res.on('error', reject);
    });
    req.setTimeout(init.timeoutMs ?? 2000, () => req.destroy(new Error('proxy hung')));
    req.on('error', reject);
    req.end();
  });
}

async function startShellProxy(upstreamOrigin: string, agent24Shell: boolean): Promise<string> {
  return await listen(createServer((request, response) => {
    const target = new URL(request.url ?? '/', upstreamOrigin);
    void proxyHttpRequest(target, request, response, { agent24Shell }).catch((error: unknown) => {
      if (response.headersSent || response.writableEnded || response.destroyed) return;
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  }));
}

describe('agent24 shell flag', () => {
  it('matches the namespace agent24-headless stamps onto the web sidecar', () => {
    const packaged = readFileSync(
      new URL('../../packaged/src/agent24-headless.ts', import.meta.url),
      'utf8',
    );
    const sidecarSource = readFileSync(new URL('../sidecar/agent24-shell.ts', import.meta.url), 'utf8');
    const runtimeSource = readFileSync(new URL('../src/runtime/agent24-shell.ts', import.meta.url), 'utf8');
    const sidecarIndex = readFileSync(new URL('../sidecar/index.ts', import.meta.url), 'utf8');
    const packagedNamespace = exportedConstString(packaged, 'AGENT24_HEADLESS_NAMESPACE');
    expect(exportedConstString(sidecarSource, 'AGENT24_HEADLESS_NAMESPACE')).toBe(packagedNamespace);
    expect(exportedConstString(runtimeSource, 'AGENT24_HEADLESS_NAMESPACE')).toBe(packagedNamespace);
    expect(AGENT24_HEADLESS_NAMESPACE).toBe(packagedNamespace);
    expect(runtimeAgent24Namespace).toBe(packagedNamespace);
    expect(packaged).toContain('namespace: AGENT24_HEADLESS_NAMESPACE');
    expect(packaged).toContain('webOutputMode: "standalone"');
    expect(sidecarIndex).toContain('namespace: client.stamp.namespace');
    expect(isAgent24HeadlessNamespace(packagedNamespace)).toBe(true);
    expect(isAgent24HeadlessNamespace('default')).toBe(false);
    expect(isAgent24HeadlessNamespace('headless')).toBe(false);
    expect(isAgent24HeadlessNamespace('agent24-creative-extra')).toBe(false);
    // The daemon's What's New gate keys off the same namespace; a drift there would
    // silently resume requests to whatsnew.open-design.ai inside Agent24.
    const whatsNew = readFileSync(new URL('../../daemon/src/services/whats-new.ts', import.meta.url), 'utf8');
    expect(whatsNew.match(/const AGENT24_HEADLESS_NAMESPACE = '([^']+)'/)?.[1]).toBe(packagedNamespace);
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
    expect(isAgent24DocumentRequest({
      method: 'HEAD',
      accept: 'text/html',
      pathname: '/',
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
    expect(rewriteAgent24ShellDocument(
      { 'content-type': 'text/html', etag: '"page"', 'content-length': '4321' },
      html,
      304,
    )).toBeNull();
    expect(rewriteAgent24ShellDocument({ 'content-type': 'text/html' }, html, 204)).toBeNull();
    expect(rewriteAgent24ShellDocument({ 'content-type': 'text/html' }, html, 100)).toBeNull();
    expect(rewriteAgent24ShellDocument({ 'content-type': 'text/html' }, Buffer.alloc(0), 200)).toBeNull();
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

  it('forwards 304, 204, HEAD, and an empty document without a boot script', async () => {
    const page = '<!doctype html><html><head></head><body>shell</body></html>';
    const upstreamOrigin = await listen(createServer((request, response) => {
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(page),
          etag: '"page"',
        });
        response.end();
        return;
      }
      if (request.url === '/not-modified') {
        response.writeHead(304, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(Buffer.byteLength(page)),
          etag: '"page"',
        });
        response.end();
        return;
      }
      if (request.url === '/empty') {
        response.writeHead(204, { 'content-type': 'text/html; charset=utf-8', etag: '"empty"' });
        response.end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': '0',
      });
      response.end();
    }));
    const origin = await startShellProxy(upstreamOrigin, true);

    const notModified = await rawRequest(origin, {
      path: '/not-modified',
      headers: { accept: 'text/html', 'if-none-match': '"page"' },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.body.length).toBe(0);
    expect(notModified.headers.etag).toBe('"page"');
    expect(notModified.headers['content-length']).toBe(String(Buffer.byteLength(page)));

    const noContent = await rawRequest(origin, {
      path: '/empty',
      headers: { accept: 'text/html' },
    });
    expect(noContent.status).toBe(204);
    expect(noContent.body.length).toBe(0);

    const head = await rawRequest(origin, {
      method: 'HEAD',
      headers: { accept: 'text/html' },
    });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength(page)));

    const blank = await rawRequest(origin, { headers: { accept: 'text/html' } });
    expect(blank.status).toBe(200);
    expect(blank.body.length).toBe(0);
    expect(blank.headers['content-length']).toBe('0');
  });

  it('passes a gzip document through byte for byte', async () => {
    const html = Buffer.from('<!doctype html><html><head></head><body>gzipped</body></html>');
    const gzipped = gzipSync(html);
    const upstreamOrigin = await listen(createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-encoding': 'gzip',
        'content-length': gzipped.length,
      });
      response.end(gzipped);
    }));
    const origin = await startShellProxy(upstreamOrigin, true);
    const result = await rawRequest(origin, {
      headers: { accept: 'text/html', 'accept-encoding': 'gzip' },
    });
    expect(result.status).toBe(200);
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.body.equals(gzipped)).toBe(true);
    expect(gunzipSync(result.body).toString('utf8')).not.toContain('data-od-agent24-shell');
  });

  it('returns 502 when the upstream document closes before end', async () => {
    const upstreamOrigin = await listen(createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.write('<html><head></head><body>partial', () => {
        // Let the proxy read the headers and enter the buffer path first.
        // Destroying in this turn RSTs unread bytes and never starts it.
        setTimeout(() => response.socket?.destroy(), 50);
      });
    }));
    const origin = await startShellProxy(upstreamOrigin, true);
    const result = await rawRequest(origin, { headers: { accept: 'text/html' } });
    expect(result.status).toBe(502);
    expect(result.body.toString('utf8')).toBe('upstream document failed');
  });

  it('destroys the upstream request when the client closes mid-document', async () => {
    let releaseUpstream!: () => void;
    const upstreamReady = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    let dropped = false;
    const upstreamOrigin = await listen(createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.write('<html><head></head><body>');
      response.on('close', () => {
        if (!response.writableFinished) dropped = true;
      });
      releaseUpstream();
    }));
    let proxySettled = false;
    const origin = await listen(createServer((request, response) => {
      const target = new URL(request.url ?? '/', upstreamOrigin);
      void proxyHttpRequest(target, request, response, { agent24Shell: true }).finally(() => {
        proxySettled = true;
      });
    }));
    const url = new URL(origin);
    await new Promise<void>((resolve, reject) => {
      const client = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: '/',
        method: 'GET',
        headers: { accept: 'text/html' },
      });
      client.on('error', () => undefined);
      client.end();
      void upstreamReady.then(() => {
        client.destroy();
        resolve();
      }).catch(reject);
    });
    const deadline = Date.now() + 1500;
    while ((!dropped || !proxySettled) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(dropped).toBe(true);
    expect(proxySettled).toBe(true);
  });

  it('streams a document past the rewrite buffer without injecting', async () => {
    const page = Buffer.alloc(AGENT24_SHELL_HTML_BUFFER_LIMIT_BYTES + 128, 0x61);
    page.write('<html><head></head><body>');
    const upstreamOrigin = await listen(createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': page.length,
      });
      response.end(page);
    }));
    const origin = await startShellProxy(upstreamOrigin, true);
    const result = await rawRequest(origin, { headers: { accept: 'text/html' }, timeoutMs: 15_000 });
    expect(result.status).toBe(200);
    expect(result.headers['content-length']).toBe(String(page.length));
    expect(result.body.equals(page)).toBe(true);
    expect(result.body.includes(Buffer.from('data-od-agent24-shell'))).toBe(false);
  }, 20_000);

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
