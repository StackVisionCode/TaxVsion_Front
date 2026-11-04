import { roleLabel } from '@core/auth/actor-labels';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { moduleLabel } from '../roles-panel/role-visuals';
import { PermissionInfo, RoleSummary } from '../../data-access/user-management.model';
import { RolesStore, notGrantableLabel, notGrantableReason } from '../../data-access/roles.store';

/**
 * B9 — crear o editar un rol de la oficina.
 *
 * El picker ofrece SOLO lo que el backend dice que hoy es concedible (`grantable`), y lo que no,
 * lo muestra apagado **con el motivo**. Ésa es la diferencia con no mostrarlo: el administrador que
 * busca un permiso y no lo encuentra cree que la aplicación está rota; el que lo ve apagado con
 * "Not included in your plan" sabe exactamente qué hacer.
 *
 * Un rol de sistema no se edita: se abre en modo lectura para poder mirar qué trae antes de
 * duplicarlo.
 */
@Component({
  selector: 'app-role-editor-drawer',
  imports: [CommonModule, FormsModule, DrawerComponent, SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './role-editor-drawer.component.html',
})
export class RoleEditorDrawerComponent implements OnInit {
  private readonly store = inject(RolesStore);

  /** Null = crear uno nuevo. */
  @Input() role: RoleSummary | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  readonly saving = this.store.saving;
  readonly error = this.store.error;
  readonly catalogByModule = this.store.catalogByModule;

  readonly name = signal('');
  readonly description = signal('');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly search = signal('');
  /** Solo lo marcado: para revisar qué da el rol sin recorrer todo el catálogo. */
  readonly onlySelected = signal(false);
  /**
   * Áreas desplegadas. Null = automático: abiertas las que tienen algo marcado (el catálogo puede llegar
   * después de abrir el panel). Al tocar cualquier área se fija lo que se ve en ese momento.
   */
  private readonly expandedByUser = signal<ReadonlySet<string> | null>(null);
  private readonly openModules = computed<ReadonlySet<string>>(
    () =>
      this.expandedByUser() ??
      new Set(
        this.catalogByModule()
          .filter((group) => group.permissions.some((permission) => this.initialCodes.has(permission.code)))
          .map((group) => group.module),
      ),
  );
  private initialCodes: ReadonlySet<string> = new Set();
  readonly moduleLabel = moduleLabel;

  readonly readOnly = computed(() => this.role?.isSystem === true);
  readonly title = computed(() =>
    this.role ? (this.readOnly() ? roleLabel(this.role.name) : `Edit ${this.role.name}`) : 'New role',
  );

  /** Sin catálogo no se puede traducir a ids: guardar dejaría el rol sin permisos. */
  readonly canSave = computed(
    () =>
      !this.readOnly() &&
      this.name().trim().length > 0 &&
      !this.saving() &&
      this.store.catalogReady(),
  );
  readonly selectedCount = computed(() => this.selected().size);
  /** En cuántas áreas hay algo marcado (resumen de la cabecera). */
  readonly selectedAreas = computed(
    () => this.catalogByModule().filter(group => group.permissions.some(p => this.selected().has(p.code))).length,
  );

  /**
   * Los módulos filtrados por el buscador (también por el nombre del área) y por "solo lo marcado";
   * un módulo sin coincidencias no se pinta.
   */
  readonly visibleModules = computed(() => {
    const query = this.search().trim().toLowerCase();
    const onlySelected = this.onlySelected();
    if (!query && !onlySelected) {
      return this.orderedModules();
    }
    return this.orderedModules()
      .map((group) => {
        const areaMatches = !!query && moduleLabel(group.module).toLowerCase().includes(query);
        return {
          module: group.module,
          permissions: group.permissions.filter(
            (permission) =>
              (!onlySelected || this.selected().has(permission.code)) &&
              (!query ||
                areaMatches ||
                permission.code.toLowerCase().includes(query) ||
                permission.description.toLowerCase().includes(query)),
          ),
        };
      })
      .filter((group) => group.permissions.length > 0);
  });

  /**
   * Primero las áreas que el rol ya usaba al abrirlo (lo que se viene a revisar), luego el resto en
   * orden alfabético. Se ordena por lo de al abrir, no por lo marcado ahora: nada salta al editar.
   */
  private readonly orderedModules = computed(() => {
    const uses = (group: { permissions: readonly PermissionInfo[] }) =>
      group.permissions.some((permission) => this.initialCodes.has(permission.code));
    return [...this.catalogByModule()].sort((a, b) => Number(uses(b)) - Number(uses(a)));
  });

  /** Buscando o viendo solo lo marcado, todo queda desplegado: lo que se pide es ver resultados. */
  isOpen(module: string): boolean {
    return !!this.search().trim() || this.onlySelected() || this.openModules().has(module);
  }

  toggleModule(module: string): void {
    this.expandedByUser.set(new Set(this.openModules()));
    this.expandedByUser.update((current) => {
      const next = new Set(current);
      if (!next.delete(module)) {
        next.add(module);
      }
      return next;
    });
  }

  readonly allExpanded = computed(() => this.catalogByModule().every((group) => this.openModules().has(group.module)));

  setAllExpanded(open: boolean): void {
    this.expandedByUser.set(open ? new Set(this.catalogByModule().map((group) => group.module)) : new Set());
  }

  /** Marcados del área sobre el total del área (la cuenta usa el catálogo completo, no el filtro). */
  selectedIn(module: string): number {
    return this.permissionsOf(module).filter((permission) => this.selected().has(permission.code)).length;
  }

  totalIn(module: string): number {
    return this.permissionsOf(module).length;
  }

  /** El interruptor del área: encendido si todo lo que se puede marcar en el área está marcado. */
  moduleOn(module: string): boolean {
    const available = this.permissionsOf(module).filter((permission) => !this.isLocked(permission));
    return available.length > 0 && available.every((permission) => this.selected().has(permission.code));
  }

  /** Sin nada concedible en el área el interruptor no hace nada: se muestra apagado y deshabilitado. */
  moduleSwitchDisabled(module: string): boolean {
    return this.readOnly() || this.permissionsOf(module).every((permission) => this.isLocked(permission));
  }

  /**
   * Encender marca todo lo concedible del área (lo bloqueado sigue bloqueado); apagar quita todo lo
   * del área, que siempre se puede quitar.
   */
  setModule(module: string, on: boolean): void {
    if (this.readOnly()) {
      return;
    }
    const permissions = this.permissionsOf(module);
    this.selected.update((current) => {
      const next = new Set(current);
      for (const permission of permissions) {
        if (on && !this.isLocked(permission)) {
          next.add(permission.code);
        } else if (!on) {
          next.delete(permission.code);
        }
      }
      return next;
    });
  }

  private permissionsOf(module: string): readonly PermissionInfo[] {
    return this.catalogByModule().find((group) => group.module === module)?.permissions ?? [];
  }

  ngOnInit(): void {
    if (this.role) {
      this.name.set(this.role.name);
      this.description.set(this.role.description ?? '');
      this.selected.set(new Set(this.role.permissionCodes));
      // Un rol que existe abre desplegadas las áreas que ya usa; uno integrado se ve directo en lo que trae.
      this.initialCodes = new Set(this.role.permissionCodes);
      this.onlySelected.set(this.readOnly());
    }
  }

  blockedReason(permission: PermissionInfo): string | null {
    const reason = notGrantableReason(permission);
    return reason === null ? null : notGrantableLabel(reason);
  }

  /**
   * Un permiso que el rol YA tiene pero que hoy no sería concedible sigue marcado y se puede quitar:
   * el plan cambió después de crearlo. Lo que no se permite es AÑADIRLO.
   */
  isLocked(permission: PermissionInfo): boolean {
    return this.blockedReason(permission) !== null && !this.selected().has(permission.code);
  }

  isSelected(code: string): boolean {
    return this.selected().has(code);
  }

  toggle(permission: PermissionInfo): void {
    if (this.readOnly() || this.isLocked(permission)) {
      return;
    }
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(permission.code)) {
        next.add(permission.code);
      }
      return next;
    });
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const name = this.name().trim();
    const description = this.description().trim() || null;
    const codes = [...this.selected()];

    // Los dos caminos devuelven cosas distintas (void vs. el rol creado) y acá da igual cuál: lo
    // único que importa es que salió bien.
    const call: Observable<unknown> = this.role
      ? this.store.update(this.role.id, name, description, codes)
      : this.store.createFromCodes(name, description, codes);

    call.subscribe({ next: () => this.saved.emit(), error: () => undefined });
  }
}
