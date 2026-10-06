import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StaffDirectoryStore, StaffMember } from '../../data-access/staff-directory.store';

export type ClientType = 'individual' | 'company';

export type BusinessStructure = 'LLC' | 'S-Corp' | 'C-Corp' | 'Partnership' | 'Sole Proprietorship';

export interface ClientIndividualDetails {
  ssnOrItin?: string;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth?: string;
  occupation?: string;
  maritalStatus?: string;
}

export interface ClientCompanyDetails {
  ein?: string;
  /** ISO date string (YYYY-MM-DD). */
  formationDate?: string;
  businessStructure?: string;
  principalBusinessActivity?: string;
}

export interface ClientItem {
  id: string;
  type: ClientType;
  /** firstName + lastName for individuals, or businessName for companies; computed at seed/save time. */
  displayName: string;
  email: string;
  phone: string;
  address: string;
  isActive: boolean;
  /** ISO date string (YYYY-MM-DD). */
  createdAt: string;
  /** userIds del staff asignado (M:N) — para los avatares de la fila. Opcional: solo el listado los trae. */
  assigneeUserIds?: string[];
  individual?: ClientIndividualDetails;
  company?: ClientCompanyDetails;
}

/**
 * Tabla del directorio (patrón "Aether"). Muestra SOLO lo que el listado paginado del
 * backend devuelve realmente (`CustomerSummaryResponse`): nombre, email, tipo, estado,
 * fecha de alta. No hay columnas de SSN/EIN/ocupación ni preparer porque el summary no
 * los trae (evita prometer datos que la API no da).
 *
 * En escritorio se pinta como tabla; en móvil (< md) como tarjetas compactas apilables.
 * Soporta selección múltiple (checkbox por fila + "seleccionar todo lo de la página").
 * Las acciones de fila (editar / activar-desactivar / archivar) se ocultan según permisos.
 */
@Component({
  selector: 'app-client-table',
  imports: [CommonModule, RouterModule, AvatarComponent, StatusPillComponent, DropdownMenuComponent, MenuItemDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-table.component.html',
  styleUrl: './client-table.component.css',
})
export class ClientTableComponent {
  @Input() clients: ClientItem[] = [];
  @Input() selectedIds: ReadonlySet<string> = new Set<string>();
  @Input() canManage = true;
  @Input() canChangeStatus = true;
  @Input() canAssignPreparer = false;
  /** Mostrar la columna "Assigned to" (roster). Solo admin/view_all — need-to-know. */
  @Input() canViewAssignees = false;

  @Output() editRequested = new EventEmitter<ClientItem>();
  @Output() toggleActiveRequested = new EventEmitter<ClientItem>();
  @Output() deleteRequested = new EventEmitter<ClientItem>();
  @Output() assignRequested = new EventEmitter<ClientItem>();
  @Output() selectToggled = new EventEmitter<string>();
  @Output() selectAllToggled = new EventEmitter<void>();

  private readonly staff = inject(StaffDirectoryStore);

  constructor() {
    // Para resolver los avatares de los asignados (userId → iniciales/color).
    this.staff.ensureLoaded();
  }

  trackByClientId(_index: number, client: ClientItem): string {
    return client.id;
  }

  isSelected(client: ClientItem): boolean {
    return this.selectedIds.has(client.id);
  }

  /** True si TODAS las filas de la página están seleccionadas (para el checkbox del header). */
  allSelected(): boolean {
    return this.clients.length > 0 && this.clients.every(c => this.selectedIds.has(c.id));
  }

  /** Cualquier acción de fila disponible (para decidir si mostrar la columna/menú). */
  hasRowActions(): boolean {
    return this.canManage || this.canChangeStatus || this.canAssignPreparer;
  }

  /** Hasta 3 avatares de staff asignado resueltos + cuántos quedan fuera (para la columna "Assigned to"). */
  assigneeAvatars(client: ClientItem): { shown: StaffMember[]; extra: number } {
    const ids = client.assigneeUserIds ?? [];
    const members = ids.map(id => this.staff.resolve(id)).filter((m): m is StaffMember => !!m);
    return { shown: members.slice(0, 3), extra: Math.max(0, ids.length - members.slice(0, 3).length) };
  }

  typeLabel(client: ClientItem): string {
    return client.type === 'individual' ? 'Individual' : 'Business';
  }

  typeBadgeClass(client: ClientItem): string {
    return client.type === 'individual' ? 'border-indigo-100 text-indigo-600' : 'border-indigo-50 text-orange-600';
  }

  formatDate(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  onSelectRow(client: ClientItem, event: Event): void {
    event.stopPropagation();
    this.selectToggled.emit(client.id);
  }

  onSelectAll(event: Event): void {
    event.stopPropagation();
    this.selectAllToggled.emit();
  }
}
