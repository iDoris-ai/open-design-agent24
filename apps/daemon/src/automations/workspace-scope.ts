import { isCloudAccountEnabled } from '../identity/cloud-account.js';

export interface PersistedAutomationWorkspaceScope {
  workspaceId: string;
  workspaceMemberId: string;
}

export class AutomationWorkspaceScopeError extends Error {
  constructor(
    readonly code:
      | 'WORKSPACE_ACCESS_DENIED',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AutomationWorkspaceScopeError';
  }
}

export function normalizePersistedAutomationWorkspaceScope(
  value: unknown,
): PersistedAutomationWorkspaceScope | null {
  // Every automation scope read (Orbit, routines, media attribution) goes
  // through here. With the cloud account disabled a stored scope, including
  // the `local` stub an older web build persisted, means nothing.
  if (!isCloudAccountEnabled()) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const workspaceId = typeof raw.workspaceId === 'string' ? raw.workspaceId.trim() : '';
  const workspaceMemberId =
    typeof raw.workspaceMemberId === 'string' ? raw.workspaceMemberId.trim() : '';
  return workspaceId && workspaceMemberId ? { workspaceId, workspaceMemberId } : null;
}

/**
 * Persist an automation's exact Workspace billing address on its new project.
 *
 * This is intentionally not an authorization check. The local membership
 * directory is UI/collaboration state and can be stale or temporarily
 * unavailable; it must never select a different wallet. At AMR spawn time the
 * daemon sends this persisted Workspace id together with the signed-in account
 * credentials, and the Vela backend remains the final membership, permission,
 * and billing authority.
 */
export function bindProjectToPersistedAutomationWorkspace(
  ensureWorkspaceProject: (input: {
    projectId: string;
    workspaceId: string;
    visibility: 'personal';
    resourceState: 'active';
    createdByWorkspaceMemberId: string;
    updatedByWorkspaceMemberId: string;
    syncState: 'local_only';
    resourceHubResourceId: null;
    cloudTombstonedAt: null;
    createdAt: number;
    updatedAt: number;
  }) => unknown,
  scope: PersistedAutomationWorkspaceScope | null,
  projectId: string,
  now: number,
): void {
  // No cloud account, no Workspace: an automation's project is a plain local
  // project. Binding it to a stored scope (the web's local stub stores
  // `local`) would hide it from the unscoped `/api/projects` list.
  if (!scope || !isCloudAccountEnabled()) return;
  ensureWorkspaceProject({
    projectId,
    workspaceId: scope.workspaceId,
    visibility: 'personal',
    resourceState: 'active',
    createdByWorkspaceMemberId: scope.workspaceMemberId,
    updatedByWorkspaceMemberId: scope.workspaceMemberId,
    syncState: 'local_only',
    resourceHubResourceId: null,
    cloudTombstonedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}
