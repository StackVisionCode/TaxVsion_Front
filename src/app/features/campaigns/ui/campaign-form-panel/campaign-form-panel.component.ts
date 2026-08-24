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
import {
  ApiCampaignType,
  CAMPAIGN_TYPES,
  CampaignFormValue,
  CampaignItem,
  CampaignTemplateSummary,
  parseCustomEmails,
} from '../../data-access/campaigns.model';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';

type AudienceOption = 'active-clients' | 'custom';

/**
 * Overlay del ciclo de vida de campañas (mismo patrón visual que invoice-form-panel:
 * tarjeta centrada `rounded-[28px]` vía app-modal). Dos modos sobre el backend real:
 *
 * - Crear (`campaign` null): name + type + plantilla publicada + audiencia (clientes
 *   activos vía GET /customers o lista manual de correos) + fecha opcional. Emite
 *   `submitted` con el CampaignFormValue; el store hace POST create (+ schedule si
 *   trae fecha). No hay modo edición: el backend no expone PUT de campañas.
 *
 * - Lanzar (`campaign` con un Draft): muestra el resumen de la campaña y pide solo la
 *   fecha (vacía = lanzar ya). Emite `launched` con YYYY-MM-DD o ''.
 *
 * El guardado real vive en la página: `saving`/`errorMessage` llegan como inputs para
 * deshabilitar el botón y mostrar el error del backend sin cerrar el panel.
 */
@Component({
  selector: 'app-campaign-form-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './campaign-form-panel.component.html',
})
export class CampaignFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  /** Draft a lanzar; null = modo creación. */
  @Input() campaign: CampaignItem | null = null;
  @Input() templates: CampaignTemplateSummary[] = [];
  @Input() templatesLoading = false;
  @Input() templatesError: string | null = null;
  @Input() saving = false;
  @Input() errorMessage: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CampaignFormValue>();
  @Output() launched = new EventEmitter<string>();
  @Output() retryTemplates = new EventEmitter<void>();

  readonly types = CAMPAIGN_TYPES;
  readonly audiences: AudienceOption[] = ['active-clients', 'custom'];

  /** Signal propia porque `campaign` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isLaunchMode = signal(false);

  readonly name = signal('');
  readonly type = signal<ApiCampaignType>('Newsletter');
  readonly templateId = signal('');
  readonly audience = signal<AudienceOption>('active-clients');
  readonly customEmails = signal('');
  readonly scheduledDate = signal('');

  readonly isTypeOpen = signal(false);
  readonly isTemplateOpen = signal(false);
  readonly isAudienceOpen = signal(false);

  readonly selectedTemplate = computed(
    () => this.templates.find(template => template.id === this.templateId()) ?? null,
  );

  /** Cuántos correos válidos hay en la lista manual (feedback en vivo bajo el textarea). */
  readonly customEmailCount = computed(() => parseCustomEmails(this.customEmails()).length);

  readonly canSave = computed(() => {
    if (this.isLaunchMode()) {
      return true;
    }
    if (this.name().trim().length === 0 || this.templateId().length === 0) {
      return false;
    }
    return this.audience() === 'active-clients' || this.customEmailCount() > 0;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['campaign'] || changes['isOpen']) {
      this.isLaunchMode.set(this.campaign !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="campaign-type"]')) {
      this.isTypeOpen.set(false);
    }
    if (!target.closest('[data-dropdown="campaign-template"]')) {
      this.isTemplateOpen.set(false);
    }
    if (!target.closest('[data-dropdown="campaign-audience"]')) {
      this.isAudienceOpen.set(false);
    }
  }

  toggleTypeDropdown(): void {
    this.isTypeOpen.update(open => !open);
  }

  toggleTemplateDropdown(): void {
    this.isTemplateOpen.update(open => !open);
  }

  toggleAudienceDropdown(): void {
    this.isAudienceOpen.update(open => !open);
  }

  selectType(type: ApiCampaignType): void {
    this.type.set(type);
    this.isTypeOpen.set(false);
  }

  selectTemplate(template: CampaignTemplateSummary): void {
    this.templateId.set(template.id);
    this.isTemplateOpen.set(false);
  }

  selectAudience(audience: AudienceOption): void {
    this.audience.set(audience);
    this.isAudienceOpen.set(false);
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

  audienceLabel(audience: AudienceOption): string {
    return audience === 'active-clients' ? 'All active clients' : 'Custom list';
  }

  templateLabel(template: CampaignTemplateSummary): string {
    return template.subject ? `${template.templateKey} — ${template.subject}` : template.templateKey;
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave() || this.saving) {
      return;
    }
    if (this.isLaunchMode()) {
      this.launched.emit(this.scheduledDate());
      return;
    }
    this.submitted.emit({
      name: this.name().trim(),
      type: this.type(),
      templateId: this.templateId(),
      audience: this.audience(),
      customEmails: this.customEmails(),
      scheduledDate: this.scheduledDate(),
    });
  }

  private resetForm(): void {
    this.name.set('');
    this.type.set('Newsletter');
    this.templateId.set('');
    this.audience.set('active-clients');
    this.customEmails.set('');
    this.scheduledDate.set('');
    this.isTypeOpen.set(false);
    this.isTemplateOpen.set(false);
    this.isAudienceOpen.set(false);
  }
}
