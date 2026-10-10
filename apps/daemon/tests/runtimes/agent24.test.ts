import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { agent24AgentDef } from '../../src/runtimes/defs/agent24.js';
import { getAgentDef } from '../../src/runtimes/registry.js';

describe('Agent24 runtime adapter', () => {
  it('registers a thin ACP runtime without custom engine behavior', () => {
    expect(getAgentDef('agent24')).toBe(agent24AgentDef);
    expect(agent24AgentDef.bin).toBe('agent24');
    expect(agent24AgentDef.versionArgs).toEqual(['--version']);
    expect(agent24AgentDef.buildArgs()).toEqual(['acp']);
    expect(agent24AgentDef.streamFormat).toBe('acp-json-rpc');
    expect(agent24AgentDef.persistVisibleTextArtifacts).toBe(true);
    expect(agent24AgentDef.fallbackModels).toEqual([
      expect.objectContaining({ id: 'default' }),
    ]);
  });

  it('persists visible-text artifacts from the uncapped assistant buffer', async () => {
    const serverSource = await readFile(new URL('../../src/server.ts', import.meta.url), 'utf8');

    expect(serverSource).toContain('extractPlainStreamArtifacts(visibleAssistantText)');
    expect(serverSource).not.toContain('extractPlainStreamArtifacts(memoryReplyText)');
  });
});
