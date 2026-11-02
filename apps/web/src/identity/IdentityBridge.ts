import type { WorkspaceCollabContext } from '@open-design/contracts';

/**
 * Local single-user identity for this fork.
 *
 * `cloud` stays null. A later Agent24 shell may post
 * `{ type: 'agent24:identity', user }`. This slice does not wire an iDoris login.
 */
export interface LocalSingleUser {
  readonly id: 'local';
  readonly displayName: 'iDoris';
  readonly cloud: null;
}

export const LocalSingleUser: LocalSingleUser = {
  id: 'local',
  displayName: 'iDoris',
  cloud: null,
};

export function currentIdentity(): LocalSingleUser {
  return LocalSingleUser;
}

/** False while `currentIdentity().cloud` is null. */
export function isCloudAccountEnabled(): boolean {
  return currentIdentity().cloud !== null;
}

export const LOCAL_WORKSPACE_ID = 'local';

/**
 * Personal, local, no-billing context.
 *
 * Seat counts are the 0/0 unknown-capacity sentinel from
 * `workspaceSeatCapacityState`. Permissions that would invite, bill, or share
 * stay off. Callers must not treat a missing context as signed-out: a null
 * context crashes surfaces that assume one exists.
 */
export function localWorkspaceContext(): WorkspaceCollabContext {
  return {
    workspaceId: LOCAL_WORKSPACE_ID,
    workspaceType: 'personal',
    workspaceMemberId: 'local',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'inactive',
    planId: null,
    providerMode: 'personal_byok',
    seatSummary: {
      seatLimit: 0,
      usedSeats: 0,
      availableSeats: 0,
      isSeatFull: false,
    },
    permissions: {
      canManageMembers: false,
      canManageBilling: false,
      canInviteMembers: false,
      canManageAutoRecharge: false,
      canShareProjects: false,
      canWriteSyncedFiles: false,
      canViewWorkspaceSettings: false,
      canManageSharedResources: false,
    },
    displayName: LocalSingleUser.displayName,
    workspaceName: LocalSingleUser.displayName,
  };
}

export function isLocalSingleUserContext(
  context: { workspaceId?: string; workspaceType?: string } | null | undefined,
): boolean {
  return context?.workspaceId === LOCAL_WORKSPACE_ID && context.workspaceType === 'personal';
}
