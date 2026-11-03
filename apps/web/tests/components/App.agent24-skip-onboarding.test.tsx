// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import { navigate, type Route } from '../../src/router';
import { loadConfig, saveConfig, syncConfigToDaemon, fetchDaemonConfig } from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgentsStream,
  fetchAppVersionInfo,
  fetchDesignSystems,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { fetchAmrModels } from '../../src/providers/daemon';
import { listProjects, listTemplates } from '../../src/state/projects';

const routeState = vi.hoisted(() => ({
  current: { kind: 'home' as const, view: 'home' as const } as Route,
}));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
  goBack: vi.fn(),
  useRoute: () => routeState.current,
}));

vi.mock('../../src/components/EntryView', () => ({
  EntryView: ({ config }: { config: AppConfig }) => (
    <>
      <div data-testid="agent-id">{config.agentId ?? 'none'}</div>
      <div data-testid="onboarding-completed">{String(config.onboardingCompleted)}</div>
    </>
  ),
}));

vi.mock('../../src/components/ProjectView', () => ({
  ProjectView: () => <div>Project view</div>,
}));

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));

vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/components/SettingsDialog', () => ({
  SettingsDialog: () => null,
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgentsStream: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>(
    '../../src/providers/daemon',
  );
  return {
    ...actual,
    fetchAmrModels: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    listProjects: vi.fn(),
    listTemplates: vi.fn(),
  };
});

vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    fetchComposioConfigFromDaemon: vi.fn().mockResolvedValue(null),
    loadConfig: vi.fn(),
    mergeDaemonConfig: vi.fn(actual.mergeDaemonConfig),
    saveConfig: vi.fn(),
    fetchDaemonConfig: vi.fn(),
    fetchMediaProvidersFromDaemon: vi.fn().mockResolvedValue({
      status: 'ok',
      providers: null,
    }),
    syncComposioConfigToDaemon: vi.fn().mockResolvedValue(true),
    syncConfigToDaemon: vi.fn().mockResolvedValue(undefined),
    syncMediaProvidersToDaemon: vi.fn().mockResolvedValue(undefined),
  };
});

const mockedNavigate = vi.mocked(navigate);
const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchAgentsStream = vi.mocked(fetchAgentsStream);
const mockedFetchAppVersionInfo = vi.mocked(fetchAppVersionInfo);
const mockedFetchDesignSystems = vi.mocked(fetchDesignSystems);
const mockedFetchPromptTemplates = vi.mocked(fetchPromptTemplates);
const mockedFetchSkills = vi.mocked(fetchSkills);
const mockedFetchAmrModels = vi.mocked(fetchAmrModels);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listTemplates);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedSaveConfig = vi.mocked(saveConfig);
const mockedSyncConfig = vi.mocked(syncConfigToDaemon);
const mockedFetchDaemonConfig = vi.mocked(fetchDaemonConfig);

function freshConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: 'daemon',
    apiKey: '',
    apiProtocol: 'anthropic',
    apiVersion: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiProviderBaseUrl: 'https://api.anthropic.com',
    apiProtocolConfigs: {},
    agentId: null,
    skillId: null,
    designSystemId: null,
    onboardingCompleted: false,
    mediaProviders: {},
    composio: {},
    agentModels: {},
    agentCliEnv: {},
    ...overrides,
  };
}

const claudeAvailable = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  available: true,
  version: '1.0.0',
  models: [{ id: 'sonnet', label: 'Sonnet' }],
};

function onboardingNavigations(): Route[] {
  return mockedNavigate.mock.calls
    .map(([route]) => route)
    .filter((route): route is Route => route.kind === 'home' && route.view === 'onboarding');
}

describe('Agent24 skips first-run onboarding', () => {
  beforeEach(() => {
    routeState.current = { kind: 'home', view: 'home' };
    window.history.replaceState({}, '', '/');
    mockedDaemonIsLive.mockResolvedValue(true);
    mockedFetchAgentsStream.mockResolvedValue([claudeAvailable]);
    mockedFetchSkills.mockResolvedValue([]);
    mockedFetchDesignSystems.mockResolvedValue([]);
    mockedFetchPromptTemplates.mockResolvedValue([]);
    mockedFetchAppVersionInfo.mockResolvedValue(null);
    mockedListProjects.mockResolvedValue([]);
    mockedListTemplates.mockResolvedValue([]);
    mockedFetchAmrModels.mockResolvedValue({
      source: 'preset',
      refreshing: false,
      models: [{ id: 'amr-model', label: 'AMR Model' }],
    });
    mockedFetchDaemonConfig.mockResolvedValue({
      onboardingCompleted: false,
      agentId: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('opens Home on the agent24 runtime and persists completion for a fresh shell', async () => {
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
    mockedLoadConfig.mockReturnValue(freshConfig());

    render(<App />);

    expect(screen.queryByText('Loading workspace…')).toBeNull();
    expect(screen.getByTestId('onboarding-completed').textContent).toBe('true');
    expect(screen.getByTestId('agent-id').textContent).toBe('agent24');

    await waitFor(() => {
      expect(mockedSyncConfig.mock.calls.some(([cfg]) => (
        (cfg as AppConfig).onboardingCompleted === true
        && (cfg as AppConfig).agentId === 'agent24'
      ))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('agent-id').textContent).toBe('agent24');
    expect(onboardingNavigations()).toEqual([]);
  });

  it('keeps a saved agent when the shell skips onboarding', async () => {
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
    mockedLoadConfig.mockReturnValue(freshConfig({ agentId: 'claude' }));
    mockedFetchDaemonConfig.mockResolvedValue({
      onboardingCompleted: false,
      agentId: 'claude',
    });

    render(<App />);

    await waitFor(() => {
      expect(mockedSyncConfig.mock.calls.some(([cfg]) => (
        (cfg as AppConfig).onboardingCompleted === true
        && (cfg as AppConfig).agentId === 'claude'
      ))).toBe(true);
    });
    expect(screen.getByTestId('agent-id').textContent).toBe('claude');
    expect(onboardingNavigations()).toEqual([]);
  });

  it('replaces a manual /onboarding visit with Home', async () => {
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
    mockedLoadConfig.mockReturnValue(freshConfig());
    routeState.current = { kind: 'home', view: 'onboarding' };
    window.history.replaceState({}, '', '/onboarding');

    render(<App />);

    await waitFor(() => {
      expect(mockedNavigate).toHaveBeenCalledWith(
        { kind: 'home', view: 'home' },
        { replace: true },
      );
    });
    expect(onboardingNavigations()).toEqual([]);
    expect(screen.getByTestId('agent-id').textContent).toBe('agent24');
  });

  it('still persists the agent24 runtime when the daemon is down', async () => {
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
    mockedLoadConfig.mockReturnValue(freshConfig());
    mockedDaemonIsLive.mockResolvedValue(false);

    render(<App />);

    await waitFor(() => {
      expect(mockedSaveConfig.mock.calls.some(([cfg]) => (
        (cfg as AppConfig).onboardingCompleted === true
        && (cfg as AppConfig).agentId === 'agent24'
      ))).toBe(true);
    });
    expect(screen.getByTestId('onboarding-completed').textContent).toBe('true');
    expect(onboardingNavigations()).toEqual([]);
  });

  it('still routes a fresh upstream install to onboarding and does not pick agent24', async () => {
    mockedLoadConfig.mockReturnValue(freshConfig());

    render(<App />);

    expect(screen.getByText('Loading workspace…')).toBeTruthy();
    await waitFor(() => {
      expect(onboardingNavigations().length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('onboarding-completed').textContent).toBe('false');
    expect(screen.getByTestId('agent-id').textContent).toBe('none');
    expect(mockedSyncConfig.mock.calls.some(([cfg]) => (
      (cfg as AppConfig | undefined)?.agentId === 'agent24'
    ))).toBe(false);
  });
});
