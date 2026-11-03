/**
 * Agent24 skips the first-run `/onboarding` page.
 *
 * That page only lists local CLIs (Claude Code, Codex, and the rest). A
 * machine without one cannot leave it, and it has no Agent24 runtime row.
 * `isAgent24Shell()` is a document flag the web sidecar stamps before the
 * app mounts, so the one-shot web boot — not the daemon — records the
 * completion. The daemon never sees that flag. Writing it on the same boot
 * pass that already persists merged config makes every `onboardingCompleted`
 * reader agree with a finished upstream install. The existing ratchet keeps
 * the bit set.
 *
 * An empty agent slot is filled with the `agent24` runtime (`agent24 acp`).
 * The generic "first available CLI" fill would pick Claude when that binary
 * exists, and would leave the slot empty when it does not — Home then
 * refuses to send. A saved agent id is left alone.
 *
 * A manual visit to `/onboarding` (address bar, Settings → reset, Cloud
 * sign-out) is replaced with Home. Callers that used to push `/onboarding`
 * push Home instead, so the replacement cannot bounce back.
 */
import { isAgent24Shell } from './agent24-shell';

export { isAgent24Shell };

/** Runtime id of the Agent24 ACP adapter (`apps/daemon` `agent24` def). */
export const AGENT24_DEFAULT_AGENT_ID = 'agent24';

export interface Agent24FirstRunConfig {
  onboardingCompleted?: boolean;
  agentId?: string | null;
}

export function withAgent24FirstRunDefaults<T extends Agent24FirstRunConfig>(
  config: T,
  agent24Shell = isAgent24Shell(),
): T {
  if (!agent24Shell) return config;
  const agentId = config.agentId ? config.agentId : AGENT24_DEFAULT_AGENT_ID;
  if (config.onboardingCompleted === true && config.agentId === agentId) return config;
  return {
    ...config,
    onboardingCompleted: true,
    agentId,
  };
}

export function onboardingEntryRoute(
  agent24Shell = isAgent24Shell(),
): { kind: 'home'; view: 'home' | 'onboarding' } {
  return agent24Shell
    ? { kind: 'home', view: 'home' }
    : { kind: 'home', view: 'onboarding' };
}

export function shouldLeaveAgent24OnboardingRoute(
  route: { kind: string; view?: string },
  agent24Shell = isAgent24Shell(),
): boolean {
  return agent24Shell && route.kind === 'home' && route.view === 'onboarding';
}
