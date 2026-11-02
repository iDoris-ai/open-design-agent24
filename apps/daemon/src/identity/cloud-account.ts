import type { Express, NextFunction, Request, Response } from 'express';

/**
 * Open Design cloud account for this fork.
 *
 * `DisabledCloudAccount` is the default. Vela, AMR, hosted credits, and the
 * collab HTTP surface stay in the tree for rebase, but the daemon does not
 * register them. One mount here answers those paths with a fixed 404 so call
 * sites do not each grow a cloud check.
 *
 * This is not CLI login (`runtimes/auth.ts`), BYOK, or xAI OAuth.
 */
export interface DisabledCloudAccount {
  readonly kind: 'disabled';
}

export const DisabledCloudAccount: DisabledCloudAccount = { kind: 'disabled' };

/** Connected Open Design cloud account. Production never installs one. */
export interface EnabledCloudAccount {
  readonly kind: 'enabled';
}

export const EnabledCloudAccount: EnabledCloudAccount = { kind: 'enabled' };

export type CloudAccount = DisabledCloudAccount | EnabledCloudAccount;

type CloudAccountFrame = { account: CloudAccount };

/** The bottom frame is the process default and is never removed. */
const cloudAccountStack: CloudAccountFrame[] = [{ account: DisabledCloudAccount }];

export function activeCloudAccount(): CloudAccount {
  return cloudAccountStack[cloudAccountStack.length - 1]!.account;
}

/**
 * Push an account for this process. Returns a restore that removes that frame,
 * not whichever frame happens to be on top.
 */
export function installCloudAccount(account: CloudAccount): () => void {
  const frame: CloudAccountFrame = { account };
  cloudAccountStack.push(frame);
  return () => {
    const index = cloudAccountStack.indexOf(frame);
    if (index > 0) cloudAccountStack.splice(index, 1);
  };
}

/** False while the active account is `DisabledCloudAccount`. */
export function isCloudAccountEnabled(): boolean {
  return activeCloudAccount().kind !== 'disabled';
}

export const CLOUD_ACCOUNT_DISABLED_BODY = {
  error: {
    code: 'cloud-account-disabled',
    message: 'Cloud account is not connected. This installation uses a local user.',
  },
} as const;

/**
 * Paths owned by `registerVelaRoutes` and `routes/collab-*.ts`, plus the
 * public-file stop retry that only exists to finish a cloud share.
 * `/api/workspaces` (plural) is the local project list and is not covered.
 */
export function isDisabledCloudAccountPath(path: string): boolean {
  if (path.startsWith('/api/integrations/vela')) return true;
  if (path === '/api/amr' || path.startsWith('/api/amr/')) return true;
  if (path === '/api/workspace' || path.startsWith('/api/workspace/')) return true;
  if (path === '/api/public-file-stops' || path.startsWith('/api/public-file-stops/')) return true;
  if (/^\/api\/projects\/[^/]+\/presence(?:\/|$)/.test(path)) return true;
  if (/^\/api\/projects\/[^/]+\/collab(?:\/|$)/.test(path)) return true;
  if (/^\/api\/projects\/[^/]+\/share-state(?:\/|$)/.test(path)) return true;
  if (/^\/api\/projects\/[^/]+\/files\/.+\/share-plan$/.test(path)) return true;
  if (/^\/api\/projects\/[^/]+\/files\/.+\/publish-public$/.test(path)) return true;
  return false;
}

export function mountDisabledCloudAccountRoutes(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isDisabledCloudAccountPath(req.path)) {
      next();
      return;
    }
    res.status(404).json(CLOUD_ACCOUNT_DISABLED_BODY);
  });
}

export function disabledCollabPresenceHandle(): {
  markPresenceStale: (projectId: string, workspaceId?: string) => void;
  invalidatePresence: (projectId: string, workspaceId?: string) => void;
} {
  return {
    markPresenceStale() {},
    invalidatePresence() {},
  };
}

export function disabledCollabSyncHandle(): {
  pullSharedProject: (
    projectId: string,
    scope: unknown,
    authorizationWitness?: unknown,
    expectedVersion?: number,
    authorizedStageInvocation?: unknown,
  ) => Promise<{ status: 'register_failed' }>;
} {
  return {
    async pullSharedProject() {
      return { status: 'register_failed' };
    },
  };
}

export function disabledVelaRoutesLifecycle(): { close: () => Promise<void> } {
  return {
    async close() {},
  };
}

/**
 * The one directory read the daemon is allowed to make toward a Vela origin.
 * While the cloud account is disabled this returns an empty directory and
 * does not call `read`, so a stored control key cannot reach `amr-api`.
 */
export function readCloudWorkspaceDirectory<T extends { ok: boolean; items: readonly unknown[] }>(
  read: () => Promise<T>,
): Promise<T | { ok: true; items: [] }> {
  if (!isCloudAccountEnabled()) return Promise.resolve({ ok: true, items: [] });
  return read();
}
