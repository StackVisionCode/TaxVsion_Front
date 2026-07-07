import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CampaignChannel, CampaignItem, CampaignStatus } from '../campaign-table/campaign-table.component';

/**
 * Vista previa de solo lectura de una campaña (mismo patrón "takeover" que
 * invoice-preview, intercambiado con la lista vía *ngIf/else en la página):
 * encabezado con canal/estado, bloque de audiencia + programación, una
 * tarjeta simple de contenido (mock "sobre" para Email, burbuja de chat para
 * SMS/WhatsApp/Push) y una fila de métricas (recipients/delivered/opened/
 * clicked) derivadas de los contadores guardados, en cero si la campaña
 * todavía no se envió.
 */
@Component({
  selector: 'app-campaign-preview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaign-preview.component.html',
})
export class CampaignPreviewComponent {
  @Input() campaign: CampaignItem | null = null;
  @Output() back = new EventEmitter<void>();

  deliveredRate(campaign: CampaignItem): number {
    return campaign.recipients > 0 ? (campaign.delivered / campaign.recipients) * 100 : 0;
  }

  openedRate(campaign: CampaignItem): number {
    return campaign.delivered > 0 ? (campaign.opened / campaign.delivered) * 100 : 0;
  }

  clickedRate(campaign: CampaignItem): number {
    return campaign.opened > 0 ? (campaign.clicked / campaign.opened) * 100 : 0;
  }

  formatDate(iso: string | null): string {
    if (!iso) {
      return 'Not scheduled';
    }
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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

  goBack(): void {
    this.back.emit();
  }
}
