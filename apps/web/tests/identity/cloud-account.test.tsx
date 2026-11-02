/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import {
  LocalSingleUser,
  currentIdentity,
  isCloudAccountEnabled,
  isLocalSingleUserContext,
  localWorkspaceContext,
} from '../../src/identity/IdentityBridge';
import { LocalAccountNotice, LocalShareUnavailableNotice } from '../../src/identity/LocalAccountNotice';
import {
  localAccountSentence,
  localShareUnavailable,
} from '../../src/identity/local-account-copy';
import { checkAmrBalanceGate } from '../../src/runtime/amr-balance-gate';
import {
  fetchAmrModels,
  fetchAmrWalletSnapshot,
  readVelaLoginStatus,
  startVelaLogin,
} from '../../src/providers/daemon';
import { listProjects } from '../../src/state/projects';

const CLOUD_HOST = /amr-api\.open-design\.ai|amr-link\.open-design\.ai|open-design\.ai\/(?:cloud|amr)(?:\/|$|\?)/;

describe('LocalSingleUser', () => {
  it('is the local iDoris identity with no cloud account', () => {
    expect(currentIdentity()).toEqual(LocalSingleUser);
    expect(LocalSingleUser).toEqual({ id: 'local', displayName: 'iDoris', cloud: null });
    expect(isCloudAccountEnabled()).toBe(false);
    const context = localWorkspaceContext();
    expect(context.workspaceType).toBe('personal');
    expect(context.workspaceId).toBe('local');
    expect(context.providerMode).toBe('personal_byok');
    expect(context.billingState).toBe('inactive');
    expect(context.planId).toBeNull();
    expect(context.permissions.canManageBilling).toBe(false);
    expect(context.permissions.canShareProjects).toBe(false);
    expect(isLocalSingleUserContext(context)).toBe(true);
    expect(context).not.toBeNull();
  });

  it('speaks the account and share sentences in Chinese, English, and Thai', () => {
    expect(localAccountSentence('zh-CN')).toBe('当前是本机用户，云账户未接入。');
    expect(localAccountSentence('en')).toBe(
      'This installation uses a local user. The cloud account is not connected.',
    );
    expect(localAccountSentence('th')).toBe(
      'ตอนนี้เป็นผู้ใช้ในเครื่องนี้ บัญชีคลาวด์ยังไม่ได้เชื่อมต่อ',
    );
    expect(localShareUnavailable('zh-CN')).toContain('分享暂时不可用');
    expect(localShareUnavailable('en')).toContain('Sharing is unavailable');
    expect(localShareUnavailable('th')).toContain('ยังแชร์ไม่ได้');

    const { unmount } = render(
      <I18nProvider initial="zh-CN">
        <LocalAccountNotice />
        <LocalShareUnavailableNotice />
      </I18nProvider>,
    );
    expect(screen.getByTestId('settings-local-account').textContent).toBe(
      '当前是本机用户，云账户未接入。',
    );
    expect(screen.getByTestId('local-share-unavailable').textContent).toContain('分享暂时不可用');
    unmount();
  });

  it('does not request amr-api or vela origins from the web choke points', async () => {
    const seen: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      seen.push(url);
      if (url === '/api/projects' || url.endsWith('/api/projects')) {
        return new Response(JSON.stringify({ projects: [{ id: 'p1', name: 'local' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('unexpected', { status: 599 });
    });
    try {
      expect(await checkAmrBalanceGate()).toEqual({ kind: 'allow' });
      expect(await fetchAmrWalletSnapshot({ refresh: true })).toBeNull();
      expect(await fetchAmrModels()).toBeNull();
      expect(await readVelaLoginStatus({ refresh: true })).toEqual({
        ok: false,
        httpStatus: 404,
        body: null,
      });
      expect((await startVelaLogin()).error).toBe('cloud-account-disabled');
      const projects = await listProjects({ workspaceContext: localWorkspaceContext() });
      expect(projects.map((project) => project.id)).toEqual(['p1']);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(seen.filter((url) => CLOUD_HOST.test(url))).toEqual([]);
    expect(seen.some((url) => url.includes('/api/workspaces/local/projects'))).toBe(false);
    expect(seen.some((url) => url === '/api/projects' || url.endsWith('/api/projects'))).toBe(true);
    expect(seen.some((url) => url.includes('amr-api') || url.includes('/api/integrations/vela') || url.includes('/api/amr/'))).toBe(false);
  });
});
