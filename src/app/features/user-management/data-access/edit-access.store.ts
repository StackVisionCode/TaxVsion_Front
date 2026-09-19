import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { UserManagementService } from './user-management.service';
import {
  UserAccessModule,
  UserAccessPermission,
  UserEffectiveAccess,
} from './user-management.model';

/**
 * Drawer-scoped store for "Edit access". Loads one user's role-granted permissions (grouped by module,
 * each flagged if denied) and tracks the admin's pending deny edits before they save.
 *
 * Deny-only model: a toggle turned OFF denies that permission for this user; ON allows it (the grant
 * itself still comes from the user's roles — this drawer never grants). `save()` replaces the whole
 * deny set. It is NOT `providedIn: 'root'` on purpose — the drawer component provides it, so each open
 * starts from a clean baseline and dirty tracking is isolated per drawer instance.
 */
@Injectable()
export class EditAccessStore {
  private readonly service = inject(UserManagementService);

  private readonly _userId = signal<string | null>(null);
  private readonly _actorType = signal<string>('');
  private readonly _roles = signal<readonly string[]>([]);
  private readonly _modules = signal<readonly UserAccessModule[]>([]);
  private readonly _permissionsVersion = signal(0);

  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);

  /** Pending deny set (permissionId). `_baseline` is what was loaded; dirty = the two differ. */
  private readonly _denied = signal<ReadonlySet<string>>(new Set());
  private readonly _baseline = signal<ReadonlySet<string>>(new Set());

  readonly userId = this._userId.asReadonly();
  readonly actorType = this._actorType.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly modules = this._modules.asReadonly();
  readonly permissionsVersion = this._permissionsVersion.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();

  /** How many permissions are currently denied — the live summary the drawer shows. */
  readonly deniedCount = computed(() => this._denied().size);

  /** True when the pending deny set differs from what was loaded — enables the Save button. */
  readonly dirty = computed(() => !sameSet(this._denied(), this._baseline()));

  isDenied(permissionId: string): boolean {
    return this._denied().has(permissionId);
  }

  /** True when every permission in the module is denied — drives the module master-toggle state. */
  isModuleFullyDenied(module: string): boolean {
    const permissions = this.permissionsIn(module);
    return (
      permissions.length > 0 &&
      permissions.every((permission) => this._denied().has(permission.permissionId))
    );
  }

  load(userId: string): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.getEffectiveAccess(userId).subscribe({
      next: (access) => this.hydrate(access),
      error: (err) => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  /** Toggle one permission's ALLOW state: `allowed=false` denies it, `allowed=true` restores it. */
  setAllowed(permissionId: string, allowed: boolean): void {
    this._denied.update((current) => {
      const next = new Set(current);
      if (allowed) {
        next.delete(permissionId);
      } else {
        next.add(permissionId);
      }
      return next;
    });
  }

  toggle(permissionId: string): void {
    this.setAllowed(permissionId, this._denied().has(permissionId));
  }

  /** Module master-toggle: allow (clear denies) or deny every permission in the module at once. */
  setModuleAllowed(module: string, allowed: boolean): void {
    const ids = this.permissionsIn(module).map((permission) => permission.permissionId);
    this._denied.update((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (allowed) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }

  /** Discard pending edits back to what was loaded. */
  reset(): void {
    this._denied.set(new Set(this._baseline()));
  }

  /**
   * PUT the whole deny set. On success the saved set becomes the new baseline, so the drawer is clean
   * again without a reload. The error is surfaced on `error()` and still propagates to the subscriber.
   */
  save(): Observable<void> {
    const userId = this._userId();
    if (userId === null) {
      throw new Error('EditAccessStore.save(): no user loaded.');
    }
    this._saving.set(true);
    this._error.set(null);
    return this.service.setPermissionOverrides(userId, [...this._denied()]).pipe(
      tap({
        next: () => {
          this._baseline.set(new Set(this._denied()));
          this._saving.set(false);
        },
        error: (err) => {
          this._error.set(toApiError(err).message);
          this._saving.set(false);
        },
      }),
    );
  }

  private hydrate(access: UserEffectiveAccess): void {
    const denied = new Set<string>();
    for (const module of access.modules) {
      for (const permission of module.permissions) {
        if (permission.denied) {
          denied.add(permission.permissionId);
        }
      }
    }
    this._userId.set(access.userId);
    this._actorType.set(access.actorType);
    this._roles.set(access.roles);
    this._modules.set(access.modules);
    this._permissionsVersion.set(access.permissionsVersion);
    this._denied.set(denied);
    this._baseline.set(new Set(denied));
    this._loading.set(false);
  }

  private permissionsIn(module: string): readonly UserAccessPermission[] {
    return this._modules().find((candidate) => candidate.module === module)?.permissions ?? [];
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}
