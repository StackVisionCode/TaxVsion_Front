import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export type ClientType = 'individual' | 'company';

export type BusinessStructure = 'LLC' | 'S-Corp' | 'C-Corp' | 'Partnership' | 'Sole Proprietorship';

/**
 * Todos los campos opcionales: el backend real (Customer.Api) no expone ssn/ein,
 * dateOfBirth ni maritalStatus vía GET (solo se pueden escribir), así que estos
 * datos solo están disponibles cuando vienen de la seed local/mock. `occupation`
 * y `businessStructure` se tipan como `string` (no como los union types de abajo)
 * porque el valor real del backend (occupationName / enum distinto) no calza con
 * las opciones fijas del dropdown del formulario.
 */
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
 * Tabla del directorio de clientes (patrón "Aether", igual que
 * invoice-table/service-catalog): header en píldora `bg-[#FAFAFA]` con
 * extremos redondeados. Columnas: Name (avatar + iniciales) / Email /
 * SSN-ITIN o EIN según el tipo / Type (badge) / Occupation o Business
 * structure / Status (chip outline) / Created / menú fantasma "..." por fila
 * con Edit / Toggle active-inactive / Delete. El click en la fila (fuera del
 * menú) navega al perfil del cliente vía routerLink.
 */
@Component({
  selector: 'app-client-table',
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-table.component.html',
})
export class ClientTableComponent {
  @Input() clients: ClientItem[] = [];
  @Output() editRequested = new EventEmitter<ClientItem>();
  @Output() toggleActiveRequested = new EventEmitter<ClientItem>();
  @Output() deleteRequested = new EventEmitter<ClientItem>();

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

  initials(client: ClientItem): string {
    const words = client.displayName.trim().split(/\s+/);
    return words.length >= 2
      ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
      : client.displayName.substring(0, 2).toUpperCase();
  }

  avatarClass(index: number): string {
    return this.avatarPalette[index % this.avatarPalette.length];
  }

  taxIdLabel(client: ClientItem): string {
    return client.type === 'individual' ? client.individual?.ssnOrItin ?? '—' : client.company?.ein ?? '—';
  }

  taxIdCaption(client: ClientItem): string {
    return client.type === 'individual' ? 'SSN/ITIN' : 'EIN';
  }

  typeLabel(client: ClientItem): string {
    return client.type === 'individual' ? 'Individual' : 'Company';
  }

  typeBadgeClass(client: ClientItem): string {
    return client.type === 'individual' ? 'border-[#CFE2F7] text-indigo-600' : 'border-[#E8F1FB] text-orange-600';
  }

  secondaryDetail(client: ClientItem): string {
    return client.type === 'individual'
      ? client.individual?.occupation ?? '—'
      : client.company?.businessStructure ?? '—';
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
