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
  suspendCloudTransportEnv,
} from '../../src/identity/cloud-account.js';
import { readRunTelemetrySinkConfig } from '../../src/langfuse-trace.js';

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

describe('DisabledCloudAccount gates', () => {
  it('ignores the cloud transport env switches and logs once', () => {
    const env: NodeJS.ProcessEnv = {
      OD_WORKSPACE_CONTEXT_SOURCE: 'vela',
      OD_COLLAB_TRANSPORT: 'vela-cli',
      OD_DATA_DIR: '/tmp/keep',
    };
    const log = vi.fn();
    const restore = suspendCloudTransportEnv(env, log);
    expect(env.OD_WORKSPACE_CONTEXT_SOURCE).toBeUndefined();
    expect(env.OD_COLLAB_TRANSPORT).toBeUndefined();
    expect(env.OD_DATA_DIR).toBe('/tmp/keep');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('OD_WORKSPACE_CONTEXT_SOURCE, OD_COLLAB_TRANSPORT');
    restore();
    expect(env.OD_WORKSPACE_CONTEXT_SOURCE).toBe('vela');
    expect(env.OD_COLLAB_TRANSPORT).toBe('vela-cli');

    const silent = vi.fn();
    suspendCloudTransportEnv({ OD_DATA_DIR: '/tmp/keep' }, silent)();
    expect(silent).not.toHaveBeenCalled();

    const restoreAccount = installCloudAccount(EnabledCloudAccount);
    try {
      const enabledEnv: NodeJS.ProcessEnv = { OD_WORKSPACE_CONTEXT_SOURCE: 'vela' };
      suspendCloudTransportEnv(enabledEnv, log);
      expect(enabledEnv.OD_WORKSPACE_CONTEXT_SOURCE).toBe('vela');
    } finally {
      restoreAccount();
    }
  });

  it('never selects the Vela telemetry sink with a stored control key', () => {
    const env: NodeJS.ProcessEnv = {
      VELA_CONTROL_KEY: 'ck_stray_upstream_key',
      HOME: '/nonexistent-odx3-home',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry-relay.example.test',
    };
    const disabled = readRunTelemetrySinkConfig(env, {});
    expect(disabled?.kind).toBe('relay');
    expect(JSON.stringify(disabled)).not.toContain('ck_stray_upstream_key');
    expect(JSON.stringify(disabled)).not.toContain('amr-api');

    const noRelay = { ...env };
    delete noRelay.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    const none = readRunTelemetrySinkConfig(noRelay, {});
    expect(none === null || none.kind !== 'vela').toBe(true);

    // Same inputs with the cloud account connected still pick Vela.
    const enabled = readRunTelemetrySinkConfig(env, {}, EnabledCloudAccount);
    expect(enabled?.kind).toBe('vela');
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
    OD_COLLAB_TRANSPORT: process.env.OD_COLLAB_TRANSPORT,
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
    // A packaged `prod` profile sets these; the disabled account ignores them.
    process.env.OD_WORKSPACE_CONTEXT_SOURCE = 'vela';
    process.env.OD_COLLAB_TRANSPORT = 'vela-cli';
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

  it('ignores OD_WORKSPACE_CONTEXT_SOURCE=vela and OD_COLLAB_TRANSPORT=vela-cli', () => {
    expect(process.env.OD_WORKSPACE_CONTEXT_SOURCE).toBeUndefined();
    expect(process.env.OD_COLLAB_TRANSPORT).toBeUndefined();
  });

  it('keeps a project created with local-stub workspace headers in the list after reload', async () => {
    const id = `odx3-list-${Date.now()}`;
    const localHeaders = {
      'x-od-workspace-id': 'local',
      'x-od-workspace-type': 'personal',
      'x-od-workspace-member-id': 'local',
      'x-od-workspace-role': 'owner',
      'x-od-workspace-lifecycle-state': 'active',
      'x-od-workspace-member-status': 'active',
      'x-od-workspace-can-share-projects': 'false',
      'x-od-workspace-can-write-synced-files': 'false',
    };
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...localHeaders },
      body: JSON.stringify({ id, name: 'stays listed', skillId: null, designSystemId: null }),
    });
    expect(created.status).toBe(200);
    // A fresh list read, as the web does after a refresh.
    const listed = await fetch(`${baseUrl}/api/projects`);
    expect(listed.status).toBe(200);
    const { projects } = (await listed.json()) as { projects: Array<{ id: string }> };
    expect(projects.map((project) => project.id)).toContain(id);
    const detail = await fetch(`${baseUrl}/api/projects/${id}`);
    expect(detail.status).toBe(200);
  }, 60_000);

  it('answers the cloud media catalogue as unavailable', async () => {
    const response = await fetch(`${baseUrl}/api/media/models?cloud=true&projectId=p1`);
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(payload.error?.code).toBe('MEDIA_CATALOG_UNAVAILABLE');
    expect(payload.error?.message).toContain('cloud account is not connected');
  });

  it('refuses the AMR cloud agent at run start', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'amr', message: 'hello' }),
    });
    const body = await response.text();
    expect(body).toContain('AGENT_UNAVAILABLE');
    expect(body).toContain('cloud account is not connected');
  }, 60_000);

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
