// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenDesignHostUpdaterStatusSnapshot } from '@open-design/host';
import { installMockOpenDesignHost } from '@open-design/host/testing';

import { UpdateDialog } from '../../src/components/UpdateDialog';
import { UpdaterPopup } from '../../src/components/UpdaterPopup';
import { WhatsNewPopup } from '../../src/components/WhatsNewPopup';
import { I18nProvider } from '../../src/i18n';

function downloadedStatus(): OpenDesignHostUpdaterStatusSnapshot {
  return {
    arch: 'arm64',
    availableVersion: '1.2.3-beta.4',
    capabilities: {
      canApplyInPlace: false,
      canDownload: true,
      canOpenInstaller: true,
      requiresManualInstall: true,
    },
    channel: 'beta',
    currentVersion: '1.2.3-beta.3',
    downloadPath: '/tmp/open-design-updater/Open Design Beta.dmg',
    enabled: true,
    mode: 'package-launcher',
    platform: 'darwin',
    state: 'downloaded',
    supported: true,
  };
}

function setAgent24Shell(on: boolean) {
  if (on) (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
  else delete (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__;
}

function renderPopups() {
  return render(
    <I18nProvider>
      <WhatsNewPopup active />
      <UpdaterPopup />
      <UpdateDialog />
    </I18nProvider>,
  );
}

describe('Agent24 release popups', () => {
  let restoreHost: (() => void) | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/whats-new')) {
      return new Response(JSON.stringify({
        version: '0.26.1',
        id: 'highlight-0-26-1',
        content: {
          title: 'OpenDesign 0.26.1 is here',
          body: 'A note',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/version')) {
      return new Response(JSON.stringify({ version: { version: '0.26.1', channel: 'stable' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  });

  afterEach(() => {
    cleanup();
    restoreHost?.();
    restoreHost = null;
    setAgent24Shell(false);
    window.localStorage.clear();
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  function installHost() {
    const status = vi.fn(async () => downloadedStatus());
    const check = vi.fn(async () => downloadedStatus());
    let openDialog: ((request: { source?: string }) => void) | null = null;
    const subscribeOpenDialog = vi.fn((listener: (request: { source?: string }) => void) => {
      openDialog = listener;
      return () => {
        openDialog = null;
      };
    });
    const setMenuLabels = vi.fn(async () => ({ ok: true as const }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status,
          check,
          subscribeOpenDialog,
          setMenuLabels,
        },
      },
    });
    return {
      status,
      check,
      subscribeOpenDialog,
      setMenuLabels,
      openDialog: () => openDialog,
    };
  }

  function fetchUrls(): string[] {
    return fetchMock.mock.calls.map((call) => String(call[0]));
  }

  it('renders neither popup and does not request whatsnew in the Agent24 shell', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const host = installHost();
    setAgent24Shell(true);
    renderPopups();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('whats-new-popup')).toBeNull();
    expect(screen.queryByTestId('entry-nav-updater')).toBeNull();
    expect(screen.queryByTestId('update-dialog')).toBeNull();
    expect(fetchUrls().some((url) => url.includes('whatsnew.open-design.ai'))).toBe(false);
    expect(fetchUrls().some((url) => url.includes('/api/whats-new'))).toBe(false);
    expect(host.status).not.toHaveBeenCalled();
    expect(host.check).not.toHaveBeenCalled();
    expect(host.subscribeOpenDialog).not.toHaveBeenCalled();
    expect(host.setMenuLabels).not.toHaveBeenCalled();
  });

  it('keeps the upstream popups and the whats-new fetch outside the Agent24 shell', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const host = installHost();
    setAgent24Shell(false);
    renderPopups();

    await waitFor(() => {
      expect(screen.getByTestId('whats-new-popup')).toBeTruthy();
      expect(screen.getByTestId('entry-nav-updater')).toBeTruthy();
    });
    expect(screen.queryByTestId('update-dialog')).toBeNull();
    expect(fetchUrls().some((url) => url.includes('/api/whats-new'))).toBe(true);
    expect(fetchUrls().some((url) => url.includes('whatsnew.open-design.ai'))).toBe(false);
    expect(host.status).toHaveBeenCalled();
    expect(host.check).not.toHaveBeenCalled();
    expect(host.subscribeOpenDialog).toHaveBeenCalled();

    await act(async () => {
      host.openDialog()?.({ source: 'test' });
    });
    expect(screen.getByTestId('update-dialog')).toBeTruthy();
    // A downloaded update skips the manual check. Idle/error still checks;
    // UpdateDialog.test.tsx covers that path.
    expect(host.check).not.toHaveBeenCalled();
  });
});
