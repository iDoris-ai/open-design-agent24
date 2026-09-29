import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

/** Agent24 Creative runtime — all execution stays in the Agent24 daemon. */
export const agent24AgentDef = {
  id: 'agent24',
  name: 'Agent24',
  bin: 'agent24',
  versionArgs: ['--version'],
  fallbackModels: [DEFAULT_MODEL_OPTION],
  buildArgs: () => ['acp'],
  streamFormat: 'acp-json-rpc',
} satisfies RuntimeAgentDef;
