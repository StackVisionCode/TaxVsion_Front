import { CUSTOM_ELEMENTS_SCHEMA, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoleSummary } from '../../data-access/user-management.model';
import { RolesStore } from '../../data-access/roles.store';
import { RoleEditorDrawerComponent } from '../role-editor-drawer/role-editor-drawer.component';

/**
 * B9 — la pestaña Roles de la administración de la oficina.
 *
 * Antes de esto, crear un rol para el equipo exigía Postman: la §34 la listaba como "No existe". El
 * caso 6 del Anexo C (un rol "Junior preparer" que ve clientes pero no los edita) no se podía armar
 * desde la aplicación.
 *
 * Los roles de sistema se listan aparte y no se editan — se abren para mirar y se duplican, que es
 * como se arma un rol nuevo en la práctica: partiendo de uno que ya funciona.
 */
@Component({
  selector: 'app-roles-panel',
  imports: [CommonModule, RoleEditorDrawerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './roles-panel.component.html',
})
export class RolesPanelComponent implements OnInit {
  protected readonly store = inject(RolesStore);

  readonly editing = signal<RoleSummary | null>(null);
  readonly editorOpen = signal(false);
  /** El rol cuya lista de usuarios está desplegada. */
  readonly expanded = signal<string | null>(null);
  /** Confirmación de baja: desactivar un rol le quita el acceso a gente de verdad. */
  readonly pendingDeactivate = signal<RoleSummary | null>(null);

  readonly customRoles = this.store.customRoles;
  readonly systemRoles = this.store.systemRoles;

  /** Rol a punto de duplicarse cuando la copia NO saldría igual al original. */
  readonly pendingDuplicate = signal<RoleSummary | null>(null);

  /** Los permisos que se perderían en esa copia. */
  readonly droppedOnDuplicate = computed(() => {
    const role = this.pendingDuplicate();
    return role ? this.store.droppedOnDuplicate(role) : [];
  });

  /**
   * Duplicar solo tiene sentido para roles de STAFF. El de Customer Portal se ofrecía y era un
   * sinsentido: sus permisos son del portal (`isCustomerPortal`), el picker de un rol de oficina
   * los excluye, y la copia habría salido vacía o rechazada por el backend.
   *
   * Lista vacía = backend viejo que no manda el dato: se deja duplicar y que decida el servidor.
   */
  canDuplicate(role: RoleSummary): boolean {
    const actors = role.assignableActorTypes ?? [];
    return actors.length === 0 || actors.some(actor => actor === 'TenantEmployee' || actor === 'TenantAdmin');
  }

  ngOnInit(): void {
    this.store.load();
  }

  usersOf(roleId: string) {
    return this.store.usersOf(roleId);
  }

  toggleUsers(role: RoleSummary): void {
    const next = this.expanded() === role.id ? null : role.id;
    this.expanded.set(next);
    if (next) {
      this.store.loadUsers(role.id);
    }
  }

  openNew(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  open(role: RoleSummary): void {
    this.editing.set(role);
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  onSaved(): void {
    this.closeEditor();
    this.store.load();
  }

  /**
   * Si la copia sale idéntica, se hace sin preguntar. Si el plan de hoy ya no permite conceder
   * alguno de sus permisos, se avisa ANTES: una copia que silenciosamente trae menos de lo que
   * dice el original es una trampa.
   */
  duplicate(role: RoleSummary): void {
    if (this.store.droppedOnDuplicate(role).length > 0) {
      this.pendingDuplicate.set(role);
      return;
    }
    this.store.duplicate(role).subscribe({ error: () => undefined });
  }

  confirmDuplicate(): void {
    const role = this.pendingDuplicate();
    if (!role) {
      return;
    }
    this.store.duplicate(role).subscribe({
      next: () => this.pendingDuplicate.set(null),
      error: () => this.pendingDuplicate.set(null),
    });
  }

  cancelDuplicate(): void {
    this.pendingDuplicate.set(null);
  }

  confirmDeactivate(role: RoleSummary): void {
    this.pendingDeactivate.set(role);
    this.store.loadUsers(role.id);
  }

  cancelDeactivate(): void {
    this.pendingDeactivate.set(null);
  }

  doDeactivate(): void {
    const role = this.pendingDeactivate();
    if (!role) {
      return;
    }
    this.store.deactivate(role.id).subscribe({
      next: () => this.pendingDeactivate.set(null),
      error: () => this.pendingDeactivate.set(null),
    });
  }

  reactivate(role: RoleSummary): void {
    this.store.reactivate(role.id).subscribe({ error: () => undefined });
  }

  /** Cuánta gente pierde acceso si el rol se desactiva. Undefined = todavía cargando. */
  affectedCount(roleId: string): number | undefined {
    return this.store.usersOf(roleId)?.length;
  }
}
