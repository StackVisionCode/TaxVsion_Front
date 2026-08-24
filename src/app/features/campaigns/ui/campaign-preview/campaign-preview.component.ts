import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiCampaignType, CampaignItem, CampaignStatus } from '../../data-access/campaigns.model';

/** Resultado del correo de prueba, ya normalizado por la página para pintarlo acá. */
export interface CampaignTestResult {
  ok: boolean;
  message: string;
}

/**
 * Vista previa de solo lectura de una campaña (mismo patrón "takeover" que invoice-preview,
 * intercambiado con la lista vía *ngIf/else en la página): encabezado con type/estado,
 * bloque de plantilla + programación, y la fila de métricas reales del backend
 * (totalRecipients/sentCount/openedCount/clickedCount, con failedCount como nota).
 *
 * El GET del backend no devuelve el contenido HTML de la campaña (solo captura la plantilla
 * al programar, para el fan-out): el mock de "content preview" se reemplaza por la tarjeta
 * de plantilla (key + subject resueltos best-effort vía el catálogo de plantillas).
 *
 * Incluye el envío de prueba real (POST {id}/send-test): la página ejecuta la llamada y
 * baja `testSending`/`testResult` como inputs.
 */
@Component({
  selector: 'app-campaign-preview',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaign-preview.component.html',
})
export class CampaignPreviewComponent implements OnChanges {
  @Input() campaign: CampaignItem | null = null;
  @Input() testSending = false;
  @Input() testResult: CampaignTestResult | null = null;
  @Output() back = new EventEmitter<void>();
  @Output() sendTest = new EventEmitter<string>();

  readonly testEmail = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['campaign']) {
      this.testEmail.set('');
    }
  }

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
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
        return 'border-[#67BAF4] text-[#1E466B]';
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

  canSendTest(): boolean {
    return this.testEmail().trim().includes('@') && !this.testSending;
  }

  onSendTest(): void {
    if (this.canSendTest()) {
      this.sendTest.emit(this.testEmail().trim());
    }
  }

  goBack(): void {
    this.back.emit();
  }
}
