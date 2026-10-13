import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SignatureStore } from '../../data-access/signature.store';
import { SignatureCapabilities } from '../../data-access/signature-permissions';
import { SignatureProfileListComponent } from '../../ui/signature-profile-list/signature-profile-list.component';
import {
  SignatureSettings,
  SignatureSettingsUpdate,
  TOKEN_EXPIRATION_MAX_HOURS,
  TOKEN_EXPIRATION_MIN_HOURS,
} from '../../data-access/signature.model';

const ALL_CHANNELS = ['Email', 'Sms', 'WhatsApp'] as const;

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

  readonly minHours = TOKEN_EXPIRATION_MIN_HOURS;
  readonly maxHours = TOKEN_EXPIRATION_MAX_HOURS;
  readonly channels = ALL_CHANNELS;

  private readonly settings = this.store.signatureSettings;
  /** Copia editable que se rehace cuando el servidor emite (carga inicial y post-guardado). */
  readonly draft = linkedSignal<SignatureSettings | null>(() => {
    const s = this.settings();
    return s ? { ...s } : null;
  });
  readonly saving = signal(false);

  constructor() {
    this.store.loadSignatureSettings();
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

  setHours(key: 'defaultTokenExpirationHours' | 'defaultReminderIntervalHours', raw: number | string): void {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) {
      return;
    }
    this.patch(key, Math.min(this.maxHours, Math.max(this.minHours, n)));
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
    const channels = this.channels.filter(c => set.has(c));
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
        maxImageBytes: d.maxImageBytes,
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
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
}
