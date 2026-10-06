import { CUSTOM_ELEMENTS_SCHEMA, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { PermissionInfo, RoleSummary } from '../../data-access/user-management.model';
import { RolesStore, notGrantableLabel, notGrantableReason } from '../../data-access/roles.store';

/**
 * B9 — crear o editar un rol de la oficina.
 *
 * El picker ofrece SOLO lo que el backend dice que hoy es concedible (`grantable`), y lo que no,
 * lo muestra apagado **con el motivo**. Ésa es la diferencia con no mostrarlo: el administrador que
 * busca "reports.view" y no lo encuentra cree que la aplicación está rota; el que lo ve apagado con
 * "Not included in your plan" sabe exactamente qué hacer.
 *
 * Un rol de sistema no se edita: se abre en modo lectura para poder mirar qué trae antes de
 * duplicarlo.
 */
@Component({
  selector: 'app-role-editor-drawer',
  imports: [CommonModule, FormsModule, DrawerComponent],
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

  readonly readOnly = computed(() => this.role?.isSystem === true);
  readonly title = computed(() =>
    this.role ? (this.readOnly() ? this.role.name : `Edit ${this.role.name}`) : 'New role',
  );

  /** Sin catálogo no se puede traducir a ids: guardar dejaría el rol sin permisos. */
  readonly canSave = computed(
    () => !this.readOnly() && this.name().trim().length > 0 && !this.saving() && this.store.catalogReady(),
  );
  readonly selectedCount = computed(() => this.selected().size);

  /** Los módulos ya filtrados por el buscador; un módulo sin coincidencias no se pinta. */
  readonly visibleModules = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.catalogByModule();
    }
    return this.catalogByModule()
      .map(group => ({
        module: group.module,
        permissions: group.permissions.filter(
          permission =>
            permission.code.toLowerCase().includes(query) ||
            permission.description.toLowerCase().includes(query),
        ),
      }))
      .filter(group => group.permissions.length > 0);
  });

  ngOnInit(): void {
    if (this.role) {
      this.name.set(this.role.name);
      this.description.set(this.role.description ?? '');
      this.selected.set(new Set(this.role.permissionCodes));
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
    this.selected.update(current => {
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
