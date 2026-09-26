import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, of } from 'rxjs';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { EditAccessStore } from '../../../user-management/data-access/edit-access.store';
import { PermissionInfo } from '../../../user-management/data-access/user-management.model';
import { UserManagementService } from '../../../user-management/data-access/user-management.service';
import { AccessModuleView, buildAccessView } from '../../../user-management/ui/edit-access-drawer/access-view';

/** El backend gatea leer y guardar accesos con este permiso. */
const ROLES_MANAGE = 'roles.manage';

/**
 * What the client can do inside their portal. Lives in the client's profile — a portal client is not a
 * teammate, so their access is not managed from the team screen. Deny-only: a toggle turned off blocks
 * that capability for this client alone; the grant itself comes from the Customer Portal role, so
 * anything no role grants shows locked.
 */
@Component({
  selector: 'app-client-portal-permissions',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [EditAccessStore],
  templateUrl: './client-portal-permissions.component.html',
  styleUrl: './client-portal-permissions.component.css',
})
export class ClientPortalPermissionsComponent implements OnChanges {
  /** Portal user of this client (Auth user id), not the customer id. */
  @Input({ required: true }) userId = '';
  @Input() clientName = '';

  private readonly store = inject(EditAccessStore);
  private readonly users = inject(UserManagementService);
  private readonly perms = inject(PermissionService);
  private readonly toast = inject(ToastService);

  readonly canManage = computed(() => this.perms.has(ROLES_MANAGE));

  readonly loading = this.store.loading;
  readonly saving = this.store.saving;
  readonly error = this.store.error;
  readonly dirty = this.store.dirty;
  readonly deniedCount = this.store.deniedCount;

  private readonly catalog = signal<PermissionInfo[]>([]);
  private loadedUserId = '';

  readonly modules = computed<AccessModuleView[]>(() =>
    buildAccessView(this.store.modules(), this.catalog(), this.store.actorType() || 'CustomerPortal'),
  );

  readonly summary = computed(() => {
    const count = this.deniedCount();
    if (count === 0) {
      return 'No restrictions · this client keeps everything the portal role grants';
    }
    return `${count} ${count === 1 ? 'capability' : 'capabilities'} restricted for this client`;
  });

  ngOnChanges(): void {
    if (!this.userId || !this.canManage() || this.userId === this.loadedUserId) {
      return;
    }
    this.loadedUserId = this.userId;
    this.store.load(this.userId);
    // Sin el catálogo solo faltan las filas bloqueadas ("no está en su rol"): se tolera el 403.
    this.users
      .getPermissions()
      .pipe(catchError(() => of<PermissionInfo[]>([])))
      .subscribe(catalog => this.catalog.set(catalog));
  }

  retry(): void {
    this.store.load(this.userId);
  }

  isDenied(permissionId: string): boolean {
    return this.store.isDenied(permissionId);
  }

  setAllowed(permissionId: string, allowed: boolean): void {
    this.store.setAllowed(permissionId, allowed);
  }

  /** Granted capabilities in the module that are currently restricted. */
  moduleDeniedCount(module: AccessModuleView): number {
    return module.rows.filter(row => !row.locked && this.store.isDenied(row.permissionId)).length;
  }

  moduleGrantedCount(module: AccessModuleView): number {
    return module.rows.filter(row => !row.locked).length;
  }

  moduleAllowed(module: AccessModuleView): boolean {
    return this.moduleDeniedCount(module) === 0;
  }

  setModuleAllowed(module: AccessModuleView, allowed: boolean): void {
    this.store.setModuleAllowed(module.key, allowed);
  }

  discard(): void {
    this.store.reset();
  }

  save(): void {
    if (!this.dirty() || this.saving()) {
      return;
    }
    this.store.save().subscribe({
      next: () => this.toast.success('Portal access updated'),
      error: () => {
        // El store ya dejó el mensaje en error(); la sección queda como está para reintentar.
      },
    });
  }
}
