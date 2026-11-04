import { roleLabel } from '@core/auth/actor-labels';
import { CUSTOM_ELEMENTS_SCHEMA, Component, Input, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoleSummary, RoleUser } from '../../data-access/user-management.model';
import { RolesStore } from '../../data-access/roles.store';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { RoleEditorDrawerComponent } from '../role-editor-drawer/role-editor-drawer.component';
import { moduleLabel, roleInitials, roleTone } from './role-visuals';

/** Cuántas áreas y caras se muestran en la tarjeta antes de resumir con "+N". */
const AREAS_PREVIEW = 3;
const PEOPLE_PREVIEW = 4;

/**
 * B9 — la pestaña Roles de la administración de la oficina.
 *
 * Cada rol es una tarjeta que dice de un vistazo qué da (áreas que cubre) y a quién (caras de quienes
 * lo tienen); la acción principal está a la vista y lo demás en el menú "⋯". Los roles propios van
 * primero, los inactivos plegados y los integrados al final: se abren para mirar y se duplican, que
 * es como se arma un rol nuevo en la práctica (partiendo de uno que ya funciona).
 */
@Component({
  selector: 'app-roles-panel',
  imports: [
    CommonModule,
    RoleEditorDrawerComponent,
    ConfirmDialogComponent,
    AvatarComponent,
    DropdownMenuComponent,
    MenuItemDirective,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './roles-panel.component.html',
})
export class RolesPanelComponent implements OnInit {
  protected readonly store = inject(RolesStore);

  /** Texto del buscador de la página (en esta pestaña busca roles). */
  @Input() set search(value: string | null) {
    this.query.set((value ?? '').trim().toLowerCase());
  }
  private readonly query = signal('');

  readonly editing = signal<RoleSummary | null>(null);
  readonly editorOpen = signal(false);
  /** El rol cuya lista de usuarios está desplegada. */
  readonly expanded = signal<string | null>(null);
  /** Confirmación de baja: desactivar un rol le quita el acceso a gente de verdad. */
  readonly pendingDeactivate = signal<RoleSummary | null>(null);
  /** Los inactivos quedan plegados: son historia, no lo que se gestiona a diario. */
  readonly showInactive = signal(false);

  /** Los integrados se muestran con su nombre legible ("Admin", no "Tenant Admin"). */
  readonly roleLabel = roleLabel;
  readonly roleTone = roleTone;
  readonly roleInitials = roleInitials;
  readonly avatarColorFor = avatarColorFor;

  private readonly matches = (role: RoleSummary): boolean => {
    const query = this.query();
    return (
      !query ||
      roleLabel(role.name).toLowerCase().includes(query) ||
      (role.description ?? '').toLowerCase().includes(query)
    );
  };

  readonly activeRoles = computed(() => this.store.customRoles().filter(role => role.isActive && this.matches(role)));
  readonly inactiveRoles = computed(() => this.store.customRoles().filter(role => !role.isActive && this.matches(role)));
  readonly systemRoles = computed(() => this.store.systemRoles().filter(this.matches));
  readonly nothingMatches = computed(
    () =>
      !!this.query() &&
      this.activeRoles().length + this.inactiveRoles().length + this.systemRoles().length === 0,
  );
  /** Buscando, los inactivos que coinciden se muestran sin tener que desplegar. */
  readonly inactiveOpen = computed(() => this.showInactive() || !!this.query());

  /** Código → área del catálogo, para decir qué cubre cada rol sin listar permisos. */
  private readonly moduleByCode = computed(
    () => new Map(this.store.catalog().map(permission => [permission.code, permission.module])),
  );

  /** Rol a punto de duplicarse cuando la copia NO saldría igual al original. */
  readonly pendingDuplicate = signal<RoleSummary | null>(null);

  /** Los permisos que se perderían en esa copia. */
  readonly droppedOnDuplicate = computed(() => {
    const role = this.pendingDuplicate();
    return role ? this.store.droppedOnDuplicate(role) : [];
  });

  readonly duplicateMessage = computed(() => {
    const role = this.pendingDuplicate();
    if (!role) {
      return '';
    }
    return `${this.droppedOnDuplicate().length} of its ${role.permissionCodes.length} permissions cannot be granted from inside your office today, so the copy will not include them:`;
  });

  constructor() {
    // Las caras de cada tarjeta: quiénes tienen cada rol (en caché por rol; una petición por rol).
    effect(() => {
      for (const role of this.store.roles()) {
        this.store.loadUsers(role.id);
      }
    });
  }

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

  usersOf(roleId: string): readonly RoleUser[] | undefined {
    return this.store.usersOf(roleId);
  }

  /** Áreas que cubre el rol, de la que más permisos tiene a la que menos. */
  areasOf(role: RoleSummary): string[] {
    const counts = new Map<string, number>();
    for (const code of role.permissionCodes) {
      const module = this.moduleByCode().get(code);
      if (module) {
        counts.set(module, (counts.get(module) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([module]) => moduleLabel(module));
  }

  areasPreview(role: RoleSummary): string[] {
    return this.areasOf(role).slice(0, AREAS_PREVIEW);
  }

  moreAreas(role: RoleSummary): number {
    return Math.max(0, this.areasOf(role).length - AREAS_PREVIEW);
  }

  /** La tarjeta cuenta a quien de verdad usa el rol: un suspendido o retirado no tiene acceso. */
  activeUsersOf(roleId: string): readonly RoleUser[] {
    return (this.usersOf(roleId) ?? []).filter(user => user.isActive);
  }

  /** La lista desplegada muestra a todos: primero los activos. */
  sortedUsers(users: readonly RoleUser[]): RoleUser[] {
    return [...users].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  }

  peoplePreview(roleId: string): readonly RoleUser[] {
    return this.activeUsersOf(roleId).slice(0, PEOPLE_PREVIEW);
  }

  morePeople(roleId: string): number {
    return Math.max(0, this.activeUsersOf(roleId).length - PEOPLE_PREVIEW);
  }

  /** "Nobody yet" / "1 person" / "5 people"; null mientras carga. */
  peopleLabel(roleId: string): string | null {
    if (!this.usersOf(roleId)) {
      return null;
    }
    const count = this.activeUsersOf(roleId).length;
    return count === 0 ? 'Nobody yet' : `${count} ${count === 1 ? 'person' : 'people'}`;
  }

  fullName(user: RoleUser): string {
    return `${user.name} ${user.lastName}`.trim();
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
