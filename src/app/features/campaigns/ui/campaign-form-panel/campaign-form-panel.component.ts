import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CampaignChannel, CampaignItem, CampaignStatus } from '../campaign-table/campaign-table.component';

const CHANNELS: CampaignChannel[] = ['email', 'sms', 'whatsapp', 'push'];
const STATUSES: CampaignStatus[] = ['draft', 'scheduled', 'active', 'sent', 'paused'];
const AUDIENCES = ['All active clients', 'New clients this month', 'Overdue accounts', 'VIP clients', 'Custom list'];

/**
 * Overlay de creación/edición de campañas (mismo patrón que
 * invoice-form-panel): tarjeta centrada `rounded-[28px]` sobre backdrop con
 * stopPropagation. Un único componente cubre ambos modos: si `campaign`
 * llega con datos precarga el formulario y actúa como edición ("Edit
 * Campaign" / "Save changes"); si es null arranca en blanco ("New Campaign"
 * / "Create campaign"). `isEditMode` es una signal propia actualizada en
 * ngOnChanges, no un computed() sobre el @Input (que no reaccionaría a sus
 * cambios). El textarea de contenido cambia su etiqueta/placeholder según el
 * canal elegido, sin editor de plantillas real.
 */
@Component({
  selector: 'app-campaign-form-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaign-form-panel.component.html',
})
export class CampaignFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() campaign: CampaignItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<CampaignItem>();

  readonly channels = CHANNELS;
  readonly statuses = STATUSES;
  readonly audiences = AUDIENCES;

  /** Signal propia porque `campaign` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly name = signal('');
  readonly channel = signal<CampaignChannel>('email');
  readonly content = signal('');
  readonly audience = signal(AUDIENCES[0]);
  readonly scheduledDate = signal('');
  readonly status = signal<CampaignStatus>('draft');

  readonly isChannelOpen = signal(false);
  readonly isAudienceOpen = signal(false);
  readonly isStatusOpen = signal(false);

  readonly canSave = computed(
    () => this.name().trim().length > 0 && this.content().trim().length > 0,
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['campaign'] || changes['isOpen']) {
      this.isEditMode.set(this.campaign !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="campaign-channel"]')) {
      this.isChannelOpen.set(false);
    }
    if (!target.closest('[data-dropdown="campaign-audience"]')) {
      this.isAudienceOpen.set(false);
    }
    if (!target.closest('[data-dropdown="campaign-status"]')) {
      this.isStatusOpen.set(false);
    }
  }

  toggleChannelDropdown(): void {
    this.isChannelOpen.update(open => !open);
  }

  toggleAudienceDropdown(): void {
    this.isAudienceOpen.update(open => !open);
  }

  toggleStatusDropdown(): void {
    this.isStatusOpen.update(open => !open);
  }

  selectChannel(channel: CampaignChannel): void {
    this.channel.set(channel);
    this.isChannelOpen.set(false);
  }

  selectAudience(audience: string): void {
    this.audience.set(audience);
    this.isAudienceOpen.set(false);
  }

  selectStatus(status: CampaignStatus): void {
    this.status.set(status);
    this.isStatusOpen.set(false);
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

  contentLabel(): string {
    return this.channel() === 'email' ? 'Subject + preview text' : 'Message';
  }

  contentPlaceholder(): string {
    switch (this.channel()) {
      case 'email':
        return 'e.g. "Tax season is here! Book your appointment before April 15th..."';
      case 'sms':
        return 'e.g. "Reminder: your tax deadline is in 5 days. Reply STOP to opt out."';
      case 'whatsapp':
        return 'e.g. "Hi! Just a friendly reminder that your documents are due soon."';
      case 'push':
        return 'e.g. "Your refund status has been updated. Tap to view details."';
    }
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const result: CampaignItem = {
      id: this.campaign?.id ?? `campaign-${Date.now()}`,
      name: this.name().trim(),
      channel: this.channel(),
      audience: this.audience(),
      content: this.content().trim(),
      status: this.status(),
      scheduledDate: this.scheduledDate() || null,
      recipients: this.campaign?.recipients ?? 0,
      delivered: this.campaign?.delivered ?? 0,
      opened: this.campaign?.opened ?? 0,
      clicked: this.campaign?.clicked ?? 0,
    };
    this.saved.emit(result);
  }

  private resetForm(): void {
    const campaign = this.campaign;
    if (campaign) {
      this.name.set(campaign.name);
      this.channel.set(campaign.channel);
      this.content.set(campaign.content);
      this.audience.set(campaign.audience);
      this.scheduledDate.set(campaign.scheduledDate ?? '');
      this.status.set(campaign.status);
    } else {
      this.name.set('');
      this.channel.set('email');
      this.content.set('');
      this.audience.set(AUDIENCES[0]);
      this.scheduledDate.set('');
      this.status.set('draft');
    }
    this.isChannelOpen.set(false);
    this.isAudienceOpen.set(false);
    this.isStatusOpen.set(false);
  }
}
