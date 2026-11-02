import { afterEach, beforeEach } from 'vitest';

import * as workspaceContext from '../../src/collab/useWorkspaceContext';
import {
  EnabledCloudAccount,
  installCloudAccount,
  type CloudBackedIdentity,
} from '../../src/identity/IdentityBridge';

/**
 * The setup file re-seeds the local stub while cloud is still off. Clear it
 * after the account is installed. A test that replaces `useWorkspaceContext`
 * with a partial mock does not use this cache; missing the export is fine.
 */
function resetWorkspaceContextCache(): void {
  try {
    workspaceContext.resetWorkspaceContextCache();
  } catch (error) {
    if (error instanceof Error && error.message.includes('resetWorkspaceContextCache')) return;
    throw error;
  }
}

/**
 * Cloud-account identity for tests that still exercise Vela, collab, billing,
 * share, or AMR. The production default stays `LocalSingleUser`.
 *
 * Call at describe (or file) scope. The setup file's `beforeEach` runs first
 * and would otherwise re-seed the local workspace stub; this hook installs
 * the account and clears that stub before the test body.
 */
export const enabledCloudIdentity: CloudBackedIdentity = {
  id: 'cloud-test',
  displayName: 'Cloud Test',
  cloud: EnabledCloudAccount,
};

export function useEnabledCloudAccount(): void {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    restore = installCloudAccount(enabledCloudIdentity);
    resetWorkspaceContextCache();
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
    resetWorkspaceContextCache();
  });
}
