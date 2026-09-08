import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

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
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-table.component.html',
  styleUrl: './client-table.component.css',
})
export class ClientTableComponent {
  @Input() clients: ClientItem[] = [];
  @Input() selectedIds: ReadonlySet<string> = new Set<string>();
  @Input() canManage = true;
  @Input() canChangeStatus = true;

  @Output() editRequested = new EventEmitter<ClientItem>();
  @Output() toggleActiveRequested = new EventEmitter<ClientItem>();
  @Output() deleteRequested = new EventEmitter<ClientItem>();
  @Output() selectToggled = new EventEmitter<string>();
  @Output() selectAllToggled = new EventEmitter<void>();

  readonly openMenuId = signal<string | null>(null);

  private readonly avatarPalette = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="client-menu"]')) {
      this.openMenuId.set(null);
    }
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
    return this.canManage || this.canChangeStatus;
  }

  initials(client: ClientItem): string {
    const words = client.displayName.trim().split(/\s+/);
    return words.length >= 2
      ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
      : client.displayName.substring(0, 2).toUpperCase();
  }

  avatarClass(index: number): string {
    return this.avatarPalette[index % this.avatarPalette.length];
  }

  typeLabel(client: ClientItem): string {
    return client.type === 'individual' ? 'Individual' : 'Business';
  }

  typeBadgeClass(client: ClientItem): string {
    return client.type === 'individual' ? 'border-indigo-100 text-indigo-600' : 'border-indigo-50 text-orange-600';
  }

  statusChip(client: ClientItem): string {
    return client.isActive ? 'border-emerald-200 text-emerald-600' : 'border-gray-300 text-gray-500';
  }

  statusDot(client: ClientItem): string {
    return client.isActive ? 'bg-emerald-500' : 'bg-gray-400';
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

  toggleMenu(client: ClientItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === client.id ? null : client.id);
  }

  onEditClick(client: ClientItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.editRequested.emit(client);
  }

  onToggleActiveClick(client: ClientItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.toggleActiveRequested.emit(client);
  }

  onDeleteClick(client: ClientItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.deleteRequested.emit(client);
  }

  onMenuClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}
