import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiCampaignType, CampaignItem, CampaignStatus, openRate } from '../../data-access/campaigns.model';

/**
 * Tabla de campañas (patrón "Aether", igual que service-catalog/invoice-table):
 * header en píldora `bg-brand-white` con extremos redondeados, columnas
 * Campaign name / Type (chip con icono) / Template / Status (chip outline) /
 * Scheduled / Recipients / Open rate y un menú fantasma "..." por fila.
 * El click en la fila (fuera del menú) abre la vista previa de solo lectura.
 *
 * Acciones cableadas al backend real (EmailCampaignsController): Launch (solo Draft,
 * POST {id}/schedule) y Cancel (POST {id}/cancel, inválido en Completed/Cancelled).
 * Edit/Duplicate/Pause del mock se retiraron: el backend no expone PUT, DELETE ni
 * pause/resume, y el GET no devuelve destinatarios para duplicar con fidelidad.
 */
@Component({
  selector: 'app-campaign-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaign-table.component.html',
})
export class CampaignTableComponent {
  @Input() campaigns: CampaignItem[] = [];
  @Input() emptyMessage = 'No campaigns match your search';
  @Output() previewRequested = new EventEmitter<CampaignItem>();
  @Output() launchRequested = new EventEmitter<CampaignItem>();
  @Output() cancelRequested = new EventEmitter<CampaignItem>();

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

  typeLabel(type: ApiCampaignType): string {
    return type;
  }

  typeIcon(type: ApiCampaignType): string {
    switch (type) {
      case 'Newsletter':
        return 'newspaper-outline';
      case 'Notification':
        return 'notifications-outline';
      case 'Marketing':
        return 'megaphone-outline';
      case 'Custom':
        return 'options-outline';
    }
  }

  typeChip(type: ApiCampaignType): string {
    switch (type) {
      case 'Newsletter':
        return 'border-indigo-200 text-indigo-500';
      case 'Notification':
        return 'border-orange-200 text-orange-500';
      case 'Marketing':
        return 'border-emerald-200 text-emerald-600';
      case 'Custom':
        return 'border-brand-light text-brand-bold';
    }
  }

  statusLabel(status: CampaignStatus): string {
    switch (status) {
      case 'draft':
        return 'Draft';
      case 'scheduled':
        return 'Scheduled';
      case 'active':
        return 'Sending';
      case 'sent':
        return 'Sent';
      case 'paused':
        return 'Paused';
      case 'cancelled':
        return 'Cancelled';
      case 'failed':
        return 'Failed';
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
      case 'cancelled':
        return 'border-gray-300 text-gray-400';
      case 'paused':
      case 'failed':
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
      case 'cancelled':
        return 'bg-gray-300';
      case 'paused':
      case 'failed':
        return 'bg-red-500';
    }
  }

  /** Solo un Draft se puede lanzar (POST {id}/schedule exige estado Draft). */
  canLaunch(campaign: CampaignItem): boolean {
    return campaign.apiStatus === 'Draft';
  }

  /** El backend rechaza cancelar Completed/Cancelled; el resto de estados sí. */
  canCancel(campaign: CampaignItem): boolean {
    return campaign.apiStatus !== 'Completed' && campaign.apiStatus !== 'Cancelled';
  }

  toggleMenu(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === campaign.id ? null : campaign.id);
  }

  onRowClick(campaign: CampaignItem): void {
    this.previewRequested.emit(campaign);
  }

  onViewClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.previewRequested.emit(campaign);
  }

  onLaunchClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.launchRequested.emit(campaign);
  }

  onCancelClick(campaign: CampaignItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.cancelRequested.emit(campaign);
  }
}
