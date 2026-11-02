// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resetWorkspaceContextCache,
  useWorkspaceContext,
} from '../src/collab/useWorkspaceContext';
import { localWorkspaceContext } from '../src/identity/IdentityBridge';

describe('useWorkspaceContext module cache', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetWorkspaceContextCache();
  });

  it('paints the local personal stub and does not read the cloud directory', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const local = localWorkspaceContext();

    const first = renderHook(() => useWorkspaceContext());
    expect(first.result.current.loading).toBe(false);
    expect(first.result.current.context).toMatchObject({
      workspaceId: local.workspaceId,
      workspaceType: 'personal',
      providerMode: 'personal_byok',
      billingState: 'inactive',
      planId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    first.unmount();

    const second = renderHook(() => useWorkspaceContext());
    expect(second.result.current.context?.workspaceId).toBe('local');
    expect(second.result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
