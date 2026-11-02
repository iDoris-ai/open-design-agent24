import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT24_DEFAULT_AGENT_ID,
  onboardingEntryRoute,
  shouldLeaveAgent24OnboardingRoute,
  withAgent24FirstRunDefaults,
} from '../../src/runtime/agent24-onboarding';

afterEach(() => {
  delete (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__;
});

describe('Agent24 first-run defaults', () => {
  it('leaves an upstream config on the onboarding route', () => {
    const config = { onboardingCompleted: false, agentId: null as string | null };

    expect(withAgent24FirstRunDefaults(config)).toBe(config);
    expect(onboardingEntryRoute()).toEqual({ kind: 'home', view: 'onboarding' });
    expect(shouldLeaveAgent24OnboardingRoute({ kind: 'home', view: 'onboarding' })).toBe(false);
  });

  it('treats a fresh Agent24 config as finished and selects the agent24 runtime', () => {
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;

    expect(withAgent24FirstRunDefaults({
      onboardingCompleted: false,
      agentId: null,
    })).toEqual({
      onboardingCompleted: true,
      agentId: 'agent24',
    });
    expect(AGENT24_DEFAULT_AGENT_ID).toBe('agent24');
    expect(onboardingEntryRoute()).toEqual({ kind: 'home', view: 'home' });
    expect(shouldLeaveAgent24OnboardingRoute({ kind: 'home', view: 'onboarding' })).toBe(true);
    expect(shouldLeaveAgent24OnboardingRoute({ kind: 'home', view: 'home' })).toBe(false);
    expect(shouldLeaveAgent24OnboardingRoute({ kind: 'project' })).toBe(false);
  });

  it('keeps a saved agent and does not copy an already-finished config', () => {
    (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = true;
    const finished = { onboardingCompleted: true, agentId: 'claude' };

    expect(withAgent24FirstRunDefaults({
      onboardingCompleted: false,
      agentId: 'claude',
    })).toEqual(finished);
    expect(withAgent24FirstRunDefaults(finished)).toBe(finished);
  });
});
