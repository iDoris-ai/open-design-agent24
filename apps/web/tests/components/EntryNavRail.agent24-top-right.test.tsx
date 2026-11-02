// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import type { WorkspaceBillingSummary, WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EntryNavRail,
  EntryTopRightCluster,
  resetWorkspaceDirectoryCache,
} from '../../src/components/EntryNavRail';
import { resetGithubStarsCacheForTests } from '../../src/components/useGithubStars';
import { I18nProvider } from '../../src/i18n';
import { WORKSPACE_CHROME_ACCOUNT_ACTIONS_ID } from '../../src/components/workspaceChromeActions';

const GITHUB_STARS_API = '/api/github/open-design';

function shellGlobal(): { __OD_IS_AGENT24__?: boolean } {
  return globalThis as typeof globalThis & { __OD_IS_AGENT24__?: boolean };
}

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-team',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: 'team_plus',
    displayName: 'Leaf',
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
  } as unknown as WorkspaceCollabContext;
}

function billing(): WorkspaceBillingSummary {
  return {
    workspaceId: 'ws-team',
    membershipTier: 'team_plus',
    totalAvailableCredits: 10,
    subscriptionCredits: 10,
    rechargeCredits: 0,
    balanceUsd: '12.00',
    subscriptionStatus: 'active',
    availableActions: [],
  } as unknown as WorkspaceBillingSummary;
}

function renderHome() {
  return render(
    <I18nProvider initial="zh-CN">
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={teamContext()}
        billing={billing()}
        balanceUsd="12.00"
      />
    </I18nProvider>,
  );
}

function renderProject() {
  return render(
    <I18nProvider initial="zh-CN">
      <EntryTopRightCluster
        page="project"
        context={teamContext()}
        billing={billing()}
        balanceUsd="12.00"
      />
    </I18nProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetWorkspaceDirectoryCache();
  resetGithubStarsCacheForTests();
  localStorage.clear();
  delete shellGlobal().__OD_IS_AGENT24__;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(GITHUB_STARS_API)) {
      return Response.json({ stargazers_count: 1200 });
    }
    if (url.includes('/messages?')) {
      return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  const chrome = document.createElement('header');
  chrome.className = 'workspace-tabs-chrome';
  const host = document.createElement('div');
  host.id = WORKSPACE_CHROME_ACCOUNT_ACTIONS_ID;
  chrome.append(host);
  document.body.append(chrome);
});

afterEach(() => {
  cleanup();
  delete shellGlobal().__OD_IS_AGENT24__;
  resetWorkspaceDirectoryCache();
  resetGithubStarsCacheForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelector('.workspace-tabs-chrome')?.remove();
});

async function flush() {
  await act(async () => {});
}

function githubStarRequests(): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes(GITHUB_STARS_API));
}

describe('top-right GitHub and credits chrome', () => {
  it('keeps both controls on Home and the project cluster outside Agent24', async () => {
    renderHome();
    await flush();
    expect(screen.getByTestId('entry-top-right-github')).toBeTruthy();
    expect(screen.getByTestId('entry-top-right-credits')).toBeTruthy();
    expect(screen.getByTestId('entry-nav-account')).toBeTruthy();
    expect(githubStarRequests().length).toBeGreaterThan(0);

    cleanup();
    resetGithubStarsCacheForTests();
    localStorage.clear();
    renderProject();
    await flush();
    expect(screen.getByTestId('entry-top-right-github')).toBeTruthy();
    expect(screen.getByTestId('entry-top-right-credits')).toBeTruthy();
  });

  it('omits both controls on Home and the project cluster in Agent24, and does not request star counts', async () => {
    shellGlobal().__OD_IS_AGENT24__ = true;
    renderHome();
    await flush();

    expect(screen.queryByTestId('entry-top-right-github')).toBeNull();
    expect(screen.queryByTestId('entry-top-right-credits')).toBeNull();
    expect(screen.queryByTestId('entry-top-right-credits-panel')).toBeNull();
    expect(document.querySelector('.entry-top-right-github')).toBeNull();
    expect(document.querySelector('.entry-top-right-credits-anchor')).toBeNull();
    expect(document.querySelector('.entry-top-right-account-pill')).toBeNull();
    expect(screen.getByTestId('entry-nav-account')).toBeTruthy();
    expect(githubStarRequests()).toEqual([]);

    cleanup();
    renderProject();
    await flush();
    expect(screen.queryByTestId('entry-top-right-github')).toBeNull();
    expect(screen.queryByTestId('entry-top-right-credits')).toBeNull();
    expect(screen.queryByTestId('entry-top-right-credits-panel')).toBeNull();
    expect(document.querySelector('.entry-top-right-credits-anchor')).toBeNull();
    expect(githubStarRequests()).toEqual([]);
  });
});
