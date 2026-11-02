import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SignatureStore } from '../../data-access/signature.store';
import { SignatureCapabilities } from '../../data-access/signature-permissions';
import { SignatureProfileListComponent } from '../../ui/signature-profile-list/signature-profile-list.component';
import { DateStampFormat, DeliveryPolicy, SignatureSettings, SignatureSettingsUpdate } from '../../data-access/signature.model';

const MB = 1024 * 1024;

/**
 * Settings → Signature: los defaults GLOBALES del despacho que heredan las solicitudes nuevas.
 * Gateada por `signature.settings.manage` (guard de ruta). Reúne los defaults de la request, la
 * verificación, la firma de oficina + su gobernanza, y los límites del plan (solo lectura). El
 * borrador local resincroniza con la verdad del servidor al cargar y tras guardar; la firma de
 * oficina se gestiona aparte con acciones instantáneas (no pasa por "Save changes").
 */
@Component({
  selector: 'app-signature-settings-page',
  imports: [RouterLink, FormsModule, SwitchComponent, SignatureProfileListComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-settings-page.component.html',
})
export class SignatureSettingsPageComponent {
  private readonly store = inject(SignatureStore);
  private readonly toast = inject(ToastService);
  readonly caps = inject(SignatureCapabilities);

  /** Rangos vigentes (techos del plan + invariantes del dominio); null mientras cargan. */
  readonly limits = this.store.limits;
  /** Canales que el plan permite: la oficina elige dentro de ellos. */
  readonly channels = computed(() => this.draft()?.planConstraints.allowedChannels ?? []);

  private readonly settings = this.store.signatureSettings;
  /** Copia editable que se rehace cuando el servidor emite (carga inicial y post-guardado). */
  readonly draft = linkedSignal<SignatureSettings | null>(() => {
    const s = this.settings();
    return s ? { ...s } : null;
  });
  readonly saving = signal(false);

  /** Formatos de fecha del estampado (los mismos que acepta el backend). */
  readonly dateFormats: ReadonlyArray<{ value: DateStampFormat; label: string }> = [
    { value: 'MonthDayYear', label: 'MM/DD/YYYY' },
    { value: 'DayMonthYear', label: 'DD/MM/YYYY' },
    { value: 'IsoDate', label: 'YYYY-MM-DD' },
  ];

  constructor() {
    this.store.loadSignatureSettings();
    this.store.loadLimits();
    // Refresca los perfiles al abrir; la lista de firma de oficina (hija) solo carga en frío.
    if (this.caps.canManagePreparerProfiles()) {
      this.store.loadSignatureProfiles(true);
    }
  }

  patch<K extends keyof SignatureSettings>(key: K, value: SignatureSettings[K]): void {
    const d = this.draft();
    if (!d) {
      return;
    }
    this.draft.set({ ...d, [key]: value });
  }

  /** Rango de cada campo de horas: vida del enlace hasta el techo del plan; recordatorios, el del dominio. */
  hoursRange(key: 'defaultTokenExpirationHours' | 'defaultReminderIntervalHours'): { min: number; max: number } | null {
    const limits = this.limits();
    const d = this.draft();
    if (!limits || !d) {
      return null;
    }
    return key === 'defaultTokenExpirationHours'
      ? { min: limits.minTokenHours, max: d.planConstraints.maxTokenExpirationHours }
      : { min: limits.minReminderIntervalHours, max: limits.maxReminderIntervalHours };
  }

  setHours(key: 'defaultTokenExpirationHours' | 'defaultReminderIntervalHours', raw: number | string): void {
    const n = Math.round(Number(raw));
    const range = this.hoursRange(key);
    if (!Number.isFinite(n) || !range) {
      return;
    }
    this.patch(key, Math.min(range.max, Math.max(range.min, n)));
  }

  readonly minLinkDays = computed(() => this.limits()?.minDeliveryLinkDays ?? null);
  readonly maxLinkDays = computed(() => this.limits()?.maxDeliveryLinkDays ?? null);
  readonly minAttachmentMb = computed(() => this.toMb(this.limits()?.minDeliveryAttachmentBytes));
  readonly maxAttachmentMb = computed(() => this.toMb(this.limits()?.maxDeliveryAttachmentBytes));

  /** Tamaño de PDF y páginas: la oficina elige hasta el techo del plan. */
  readonly maxPdfMb = computed(() => this.toMb(this.draft()?.planConstraints.maxAllowedPdfBytes));

  private toMb(bytes: number | undefined): number | null {
    return bytes === undefined ? null : Math.floor(bytes / MB);
  }

  setPdfMb(raw: number | string): void {
    const n = Math.round(Number(raw));
    const max = this.maxPdfMb();
    if (Number.isFinite(n) && max !== null) {
      this.patch('maxPdfBytes', Math.min(max, Math.max(1, n)) * MB);
    }
  }

  setPages(raw: number | string): void {
    const n = Math.round(Number(raw));
    const d = this.draft();
    if (Number.isFinite(n) && d) {
      this.patch('maxPagesPerDocument', Math.min(d.planConstraints.maxAllowedPages, Math.max(1, n)));
    }
  }

  setRetentionYears(raw: number | string): void {
    const n = Math.round(Number(raw));
    const d = this.draft();
    const limits = this.limits();
    if (Number.isFinite(n) && d && limits) {
      this.patch('retentionYears', Math.min(limits.maxRetentionYears, Math.max(d.planConstraints.minRetentionYears, n)));
    }
  }

  patchDelivery<K extends keyof DeliveryPolicy>(key: K, value: DeliveryPolicy[K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, delivery: { ...d.delivery, [key]: value } });
  }

  setLinkDays(raw: number | string): void {
    const n = Math.round(Number(raw));
    const min = this.minLinkDays();
    const max = this.maxLinkDays();
    if (Number.isFinite(n) && min !== null && max !== null) {
      this.patchDelivery('linkLifetimeDays', Math.min(max, Math.max(min, n)));
    }
  }

  attachmentMb(bytes: number): number {
    return Math.round(bytes / MB);
  }

  setAttachmentMb(raw: number | string): void {
    const n = Math.round(Number(raw));
    const min = this.minAttachmentMb();
    const max = this.maxAttachmentMb();
    if (Number.isFinite(n) && min !== null && max !== null) {
      this.patchDelivery('maxAttachmentBytes', Math.min(max, Math.max(min, n)) * MB);
    }
  }

  isChannelOn(channel: string): boolean {
    return this.draft()?.allowedVerificationChannels.includes(channel) ?? false;
  }

  /** Mantiene al menos un canal y un default válido dentro de los permitidos. */
  toggleChannel(channel: string, on: boolean): void {
    const d = this.draft();
    if (!d) {
      return;
    }
    const set = new Set(d.allowedVerificationChannels);
    if (on) {
      set.add(channel);
    } else {
      set.delete(channel);
    }
    if (set.size === 0) {
      return;
    }
    const channels = this.channels().filter(c => set.has(c));
    const defaultChannel = set.has(d.defaultVerificationChannel) ? d.defaultVerificationChannel : channels[0];
    this.draft.set({ ...d, allowedVerificationChannels: channels, defaultVerificationChannel: defaultChannel });
  }

  save(): void {
    const d = this.draft();
    if (!d || this.saving()) {
      return;
    }
    this.saving.set(true);
    const body: SignatureSettingsUpdate = {
      allowedVerificationChannels: d.allowedVerificationChannels,
      defaultVerificationChannel: d.defaultVerificationChannel,
      defaultTokenExpirationHours: d.defaultTokenExpirationHours,
      remindersEnabledByDefault: d.remindersEnabledByDefault,
      generateCertificateByDefault: d.generateCertificateByDefault,
      documentLimits: {
        maxPdfBytes: d.maxPdfBytes,
        maxPagesPerDocument: d.maxPagesPerDocument,
      },
      retentionPolicy: { retentionYears: d.retentionYears, allowPurge: d.allowPurge },
      defaultReminderIntervalHours: d.defaultReminderIntervalHours,
      allowEmployeeOwnSignature: d.allowEmployeeOwnSignature,
      sendPartialCopyDefault: d.sendPartialCopyDefault,
      partialCopyDefaultAudienceKind: d.partialCopyDefaultAudienceKind,
      sendSealedDocumentDefault: d.sendSealedDocumentDefault,
      expirationEnabledByDefault: d.expirationEnabledByDefault,
      sendCertificateToSignersDefault: d.sendCertificateToSignersDefault,
      requiresConsentByDefault: d.requiresConsentByDefault,
      delivery: d.delivery,
      showSignatureFrame: d.showSignatureFrame,
      dateStampFormat: d.dateStampFormat,
    };
    this.store.saveSignatureSettings(body).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Signature settings saved.');
      },
      error: () => {
        this.saving.set(false);
        this.toast.error("Couldn't save signature settings. Check the values and try again.");
      },
    });
  }

  formatBytes(bytes: number): string {
    const mb = bytes / MB;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
}
