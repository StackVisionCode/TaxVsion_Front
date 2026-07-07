import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export type ClientType = 'individual' | 'company';

export type Occupation =
  | 'Accountant'
  | 'Engineer'
  | 'Teacher'
  | 'Nurse'
  | 'Sales Representative'
  | 'Software Developer'
  | 'Business Owner'
  | 'Retired';

export type MaritalStatus = 'Single' | 'Married' | 'Divorced' | 'Widowed';

export type BusinessStructure = 'LLC' | 'S-Corp' | 'C-Corp' | 'Partnership' | 'Sole Proprietorship';

export interface ClientIndividualDetails {
  ssnOrItin: string;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth: string;
  occupation: Occupation;
  maritalStatus: MaritalStatus;
}

export interface ClientCompanyDetails {
  ein: string;
  /** ISO date string (YYYY-MM-DD). */
  formationDate: string;
  businessStructure: BusinessStructure;
  principalBusinessActivity: string;
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
 * invoice-table/service-catalog): header en píldora `bg-[#FAF9F7]` con
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

  private readonly avatarPalette = ['bg-indigo-500', 'bg-orange-500', 'bg-[#7C6AE0]', 'bg-emerald-500', 'bg-gray-900'];

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
    return client.type === 'individual' ? 'border-[#CBD9F2] text-indigo-600' : 'border-[#F2E3C9] text-orange-600';
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
