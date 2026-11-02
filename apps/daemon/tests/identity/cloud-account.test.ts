import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CLOUD_ACCOUNT_DISABLED_BODY,
  DisabledCloudAccount,
  EnabledCloudAccount,
  activeCloudAccount,
  installCloudAccount,
  isCloudAccountEnabled,
  isDisabledCloudAccountPath,
  mountDisabledCloudAccountRoutes,
  readCloudWorkspaceDirectory,
} from '../../src/identity/cloud-account.js';

const CLOUD_HOST = /amr-api\.open-design\.ai|amr-link\.open-design\.ai|open-design\.ai\/(?:cloud|amr)(?:\/|$|\?)/;

function requestTarget(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string' || first instanceof URL) return String(first);
  if (first && typeof first === 'object') {
    const options = first as { protocol?: string; hostname?: string; host?: string; path?: string; href?: string };
    if (typeof options.href === 'string') return options.href;
    const host = options.hostname || options.host || '';
    if (!host) return '';
    return `${options.protocol ?? 'https:'}//${host}${options.path ?? ''}`;
  }
  return '';
}

describe('DisabledCloudAccount', () => {
  it('installCloudAccount restores the disabled default frame', () => {
    expect(activeCloudAccount()).toEqual(DisabledCloudAccount);
    const restore = installCloudAccount(EnabledCloudAccount);
    try {
      expect(activeCloudAccount()).toEqual(EnabledCloudAccount);
      expect(isCloudAccountEnabled()).toBe(true);
    } finally {
      restore();
    }
    expect(activeCloudAccount()).toEqual(DisabledCloudAccount);
    expect(isCloudAccountEnabled()).toBe(false);
  });

  it('is the default and does not treat local project paths as cloud routes', () => {
    expect(isCloudAccountEnabled()).toBe(false);
    expect(isDisabledCloudAccountPath('/api/projects')).toBe(false);
    expect(isDisabledCloudAccountPath('/api/workspaces/local/projects')).toBe(false);
    expect(isDisabledCloudAccountPath('/api/integrations/vela/status')).toBe(true);
    expect(isDisabledCloudAccountPath('/api/amr/models')).toBe(true);
    expect(isDisabledCloudAccountPath('/api/workspace/context')).toBe(true);
    expect(isDisabledCloudAccountPath('/api/projects/p1/collab/pull')).toBe(true);
    expect(isDisabledCloudAccountPath('/api/projects/p1/files/index.html/share-plan')).toBe(true);
  });

  it('answers cloud paths with a fixed 404 and does not call the upstream reader', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalHttpsRequest = https.request;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      seen.push(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      return originalFetch(input, init);
    });
    const httpsSpy = vi.spyOn(https, 'request').mockImplementation((...args: Parameters<typeof https.request>) => {
      seen.push(requestTarget(args));
      return originalHttpsRequest.apply(https, args);
    });
    const read = vi.fn(async () => ({ ok: true as const, items: [{ workspaceId: 'cloud' }] }));
    const directory = await readCloudWorkspaceDirectory(read);
    expect(directory).toEqual({ ok: true, items: [] });
    expect(read).not.toHaveBeenCalled();

    const app = express();
    mountDisabledCloudAccountRoutes(app);
    app.get('/api/projects', (_req, res) => {
      res.json({ projects: [] });
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/api/integrations/vela/status`);
      expect(denied.status).toBe(404);
      expect(await denied.json()).toEqual(CLOUD_ACCOUNT_DISABLED_BODY);
      const projects = await fetch(`http://127.0.0.1:${port}/api/projects`);
      expect(projects.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fetchSpy.mockRestore();
      httpsSpy.mockRestore();
    }
    expect(seen.filter((url) => CLOUD_HOST.test(url))).toEqual([]);
    expect(seen.some((url) => url.includes('/api/integrations/vela/status'))).toBe(true);
  });
});

describe('startServer under DisabledCloudAccount', () => {
  const calls: string[] = [];
  let server: http.Server;
  let shutdown: (() => Promise<void>) | undefined;
  let baseUrl: string;
  const savedEnv = {
    OD_DATA_DIR: process.env.OD_DATA_DIR,
    OD_WORKSPACE_CONTEXT_SOURCE: process.env.OD_WORKSPACE_CONTEXT_SOURCE,
    OD_COLLAB_CLOUD_URL: process.env.OD_COLLAB_CLOUD_URL,
    VELA_CONTROL_KEY: process.env.VELA_CONTROL_KEY,
    VELA_API_URL: process.env.VELA_API_URL,
  };
  let dataDir = '';
  const originalFetch = globalThis.fetch;
  const originalHttpsRequest = https.request;
  const originalHttpRequest = http.request;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'odx3-cloud-account-'));
    process.env.OD_DATA_DIR = dataDir;
    delete process.env.OD_WORKSPACE_CONTEXT_SOURCE;
    delete process.env.OD_COLLAB_CLOUD_URL;
    delete process.env.VELA_CONTROL_KEY;
    delete process.env.VELA_API_URL;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      return originalFetch(input, init);
    }) as typeof fetch;
    https.request = ((...args: unknown[]) => {
      calls.push(requestTarget(args));
      return originalHttpsRequest.apply(https, args as Parameters<typeof https.request>);
    }) as typeof https.request;
    http.request = ((...args: unknown[]) => {
      calls.push(requestTarget(args));
      return originalHttpRequest.apply(http, args as Parameters<typeof http.request>);
    }) as typeof http.request;

    const { startServer } = await import('../../src/server.js');
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void>;
    };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
  }, 120_000);

  afterAll(async () => {
    await shutdown?.().catch(() => undefined);
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    globalThis.fetch = originalFetch;
    https.request = originalHttpsRequest;
    http.request = originalHttpRequest;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Shutdown still flushes diagnostics after the HTTP server emits close.
    if (dataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('keeps DisabledCloudAccount when startServer is called without cloudAccount', () => {
    expect(activeCloudAccount()).toEqual(DisabledCloudAccount);
    expect(isCloudAccountEnabled()).toBe(false);
  });

  it('creates a personal project without calling a cloud origin', async () => {
    const before = calls.length;
    const id = `odx3-${Date.now()}`;
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name: 'local byok project', skillId: null, designSystemId: null }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { project?: { id?: string }; id?: string };
    expect(body.project?.id ?? body.id).toBe(id);

    const cloudPaths = [
      '/api/integrations/vela/status',
      '/api/amr/models',
      '/api/workspace/context',
      '/api/workspace/billing',
      `/api/projects/${id}/collab`,
      `/api/projects/${id}/presence`,
      `/api/projects/${id}/files/index.html/share-plan`,
    ];
    for (const cloudPath of cloudPaths) {
      const response = await fetch(`${baseUrl}${cloudPath}`);
      expect(response.status, cloudPath).toBe(404);
      const payload = (await response.json()) as { error?: { code?: string } };
      expect(payload.error?.code, cloudPath).toBe('cloud-account-disabled');
    }

    const during = calls.slice(before);
    expect(during.filter((url) => CLOUD_HOST.test(url))).toEqual([]);
    expect(during.join('\n')).not.toMatch(/amr-api\.open-design\.ai/);
  }, 60_000);
});

describe('startServer with EnabledCloudAccount', () => {
  let server: http.Server;
  let shutdown: (() => Promise<void>) | undefined;
  let baseUrl: string;
  let dataDir = '';
  const savedDataDir = process.env.OD_DATA_DIR;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'odx3-cloud-account-enabled-'));
    process.env.OD_DATA_DIR = dataDir;
    const { startServer } = await import('../../src/server.js');
    const started = (await startServer({
      port: 0,
      returnServer: true,
      cloudAccount: EnabledCloudAccount,
    })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void>;
    };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
    expect(activeCloudAccount()).toEqual(EnabledCloudAccount);
    expect(isCloudAccountEnabled()).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await shutdown?.().catch(() => undefined);
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (savedDataDir === undefined) delete process.env.OD_DATA_DIR;
    else process.env.OD_DATA_DIR = savedDataDir;
    if (dataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('does not answer cloud routes with the disabled account body', async () => {
    const response = await fetch(`${baseUrl}/api/integrations/vela/status`);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).not.toBe('cloud-account-disabled');
  });
});
