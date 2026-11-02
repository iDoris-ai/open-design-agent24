import { isCloudAccountEnabled } from '../identity/IdentityBridge';

export function orderAgentsWithOpenDesignFirst<T extends { id: string }>(
  agents: readonly T[],
): T[] {
  if (!isCloudAccountEnabled()) {
    return [
      ...agents.filter((agent) => agent.id !== 'amr'),
      ...agents.filter((agent) => agent.id === 'amr'),
    ];
  }
  const openDesignAgents: T[] = [];
  const otherAgents: T[] = [];
  for (const agent of agents) {
    if (agent.id === 'amr') {
      openDesignAgents.push(agent);
    } else {
      otherAgents.push(agent);
    }
  }
  return [...openDesignAgents, ...otherAgents];
}
