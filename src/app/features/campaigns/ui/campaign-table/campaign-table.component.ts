import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CampaignChannel = 'email' | 'sms' | 'whatsapp' | 'push';
export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'sent' | 'paused';

export interface CampaignItem {
  id: string;
  name: string;
  channel: CampaignChannel;
  audience: string;
  content: string;
  status: CampaignStatus;
  /** ISO date string (YYYY-MM-DD), null when no schedule was set. */
  scheduledDate: string | null;
  recipients: number;
  delivered: number;
  opened: number;
  clicked: number;
}

/** Deriva la tasa de apertura de una campaña como porcentaje sobre los entregados; 0 si todavía no se entregó nada. */
export function openRate(campaign: CampaignItem): number {
  return campaign.delivered > 0 ? (campaign.opened / campaign.delivered) * 100 : 0;
}

/**
 * Tabla de campañas (patrón "Aether", igual que service-catalog/invoice-table):
 * header en píldora `bg-[#FAF9F7]` con extremos redondeados, columnas
 * Campaign name / Channel (chip con icono) / Audience / Status (chip outline) /
 * Sent date / Recipients / Open rate y un menú fantasma "..." por fila con
 * Edit/Duplicate/Pause-Resume/Delete. El click en la fila (fuera del menú)
 * abre la vista previa de solo lectura.
 */
@Component({
  selector: 'app-campaign-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaign-table.component.html',
})
export class CampaignTableComponent {
  @Input() campaigns: CampaignItem[] = [];
  @Output() previewRequested = new EventEmitter<CampaignItem>();
  @Output() editRequested = new EventEmitter<CampaignItem>();
  @Output() duplicateRequested = new EventEmitter<CampaignItem>();
  @Output() pauseResumeRequested = new EventEmitter<CampaignItem>();
  @Output() deleteRequested = new EventEmitter<CampaignItem>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="campaign-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByCampaignId(_index: number, campaign: CampaignItem): string {
    return campaign.id;
  }

  openRate(campaign: CampaignItem): number {
    return openRate(campaign);
  }

  formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  channelLabel(channel: CampaignChannel): string {
    switch (channel) {
      case 'email':
        return 'Email';
      case 'sms':
        return 'SMS';
      case 'whatsapp':
        return 'WhatsApp';
      case 'push':
        return 'Push';
    }
  }

  channelIcon(channel: CampaignChannel): string {
    switch (channel) {
      case 'email':
        return 'mail-outline';
      case 'sms':
        return 'chatbox-outline';
      case 'whatsapp':
        return 'logo-whatsapp';
      case 'push':
        return 'notifications-outline';
    }
  }

  channelChip(channel: CampaignChannel): string {
    switch (channel) {
      case 'email':
        return 'border-indigo-200 text-indigo-500';
      case 'sms':
        return 'border-orange-200 text-orange-500';
      case 'whatsapp':
        return 'border-emerald-200 text-emerald-600';
      case 'push':
        return 'border-[#A99BEB] text-[#7C6AE0]';
    }
  }

  statusLabel(status: CampaignStatus): string {
    switch (status) {
      case 'draft':
        return 'Draft';
      case 'scheduled':
        return 'Scheduled';
      case 'active':
        return 'Active';
      case 'sent':
        return 'Sent';
      case 'paused':
        return 'Paused';
    }
  }

  statusChip(status: CampaignStatus): string {
    switch (status) {
      case 'active':
      case 'sent':
        return 'border-emerald-200 text-emerald-600';
      case 'scheduled':
        return 'border-orange-200 text-orange-500';
      case 'draft':
        return 'border-gray-300 text-gray-500';
      case 'paused':
        return 'border-red-200 text-red-500';
    }
  }

  statusDot(status: CampaignStatus): string {
    switch (status) {
      case 'active':
      case 'sent':
        return 'bg-emerald-500';
      case 'scheduled':
        return 'bg-orange-500';
      case 'draft':
        return 'bg-gray-400';
      case 'paused':
        return 'bg-red-500';
    }
  }

  canPause(campaign: CampaignItem): boolean {
    return campaign.status === 'active' || campaign.status === 'scheduled' || campaign.status === 'paused';
  }

  pauseResumeLabel(campaign: CampaignItem): string {
    return campaign.status === 'paused' ? 'Resume' : 'Pause';
  }

  toggleMenu(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === campaign.id ? null : campaign.id);
  }

  onRowClick(campaign: CampaignItem): void {
    this.previewRequested.emit(campaign);
  }

  onEditClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.editRequested.emit(campaign);
  }

  onDuplicateClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.duplicateRequested.emit(campaign);
  }

  onPauseResumeClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.pauseResumeRequested.emit(campaign);
  }

  onDeleteClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.deleteRequested.emit(campaign);
  }
}
