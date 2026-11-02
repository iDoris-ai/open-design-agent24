import type { WorkspaceCollabContext } from '@open-design/contracts';

/**
 * Local single-user identity for this fork.
 *
 * The default `cloud` is null. A later Agent24 shell may post
 * `{ type: 'agent24:identity', user }`. This slice does not wire an iDoris login.
 * Tests opt into the cloud surface with `installCloudAccount`.
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

/**
 * A connected Open Design cloud account. Production never installs one.
 * Tests that still exercise Vela, collab, billing, share, or AMR pass this
 * to `installCloudAccount` for the duration of the case.
 */
export interface EnabledCloudAccount {
  readonly kind: 'enabled';
}

export const EnabledCloudAccount: EnabledCloudAccount = { kind: 'enabled' };

export interface CloudBackedIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly cloud: EnabledCloudAccount;
}

export type ActiveIdentity = LocalSingleUser | CloudBackedIdentity;

type IdentityFrame = { identity: ActiveIdentity };
const identityStack: IdentityFrame[] = [{ identity: LocalSingleUser }];

export function currentIdentity(): ActiveIdentity {
  return identityStack[identityStack.length - 1]!.identity;
}

/**
 * Install an identity for this process. The default frame is `LocalSingleUser`
 * and is never removed. Returns a restore function.
 */
export function installCloudAccount(identity: ActiveIdentity): () => void {
  const frame: IdentityFrame = { identity };
  identityStack.push(frame);
  return () => {
    const index = identityStack.indexOf(frame);
    if (index > 0) identityStack.splice(index, 1);
  };
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
