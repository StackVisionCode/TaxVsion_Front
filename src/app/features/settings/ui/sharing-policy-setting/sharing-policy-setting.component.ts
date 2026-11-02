import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PermissionService } from '@core/auth/permission.service';
import { SharingPolicy } from '@core/cloud-storage/cloud-storage.model';
import { StoragePolicyService } from '@core/cloud-storage/storage-policy.service';
import { toUserMessage } from '@core/errors/error-messages';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SharingPolicyUpdate, StorageSettingsService } from '../../data-access/storage-settings.service';

const MANAGE_PERMISSION = 'cloudstorage.settings.manage';

/**
 * Reglas de compartir de la oficina para los enlaces que salen de ella (secure link, público y
 * destinatarios externos): vida por defecto y máxima, contraseña obligatoria y su largo, intentos
 * antes de bloquear el enlace y tope de descargas. Los rangos los valida el backend y su mensaje
 * se muestra tal cual. Solo con `cloudstorage.settings.manage`.
 */
@Component({
  selector: 'app-sharing-policy-setting',
  standalone: true,
  imports: [FormsModule, SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sharing-policy-setting.component.html',
})
export class SharingPolicySettingComponent {
  private readonly perms = inject(PermissionService);
  private readonly settings = inject(StorageSettingsService);
  private readonly storagePolicy = inject(StoragePolicyService);
  private readonly toast = inject(ToastService);

  readonly canManage = computed(() => this.perms.has(MANAGE_PERMISSION));
  readonly loading = signal(true);
  readonly saving = signal(false);
  /** Copia editable; el campo de descargas va como texto para permitir "vacío = sin tope". */
  readonly draft = signal<SharingPolicyUpdate | null>(null);
  readonly maxDownloadsText = signal('');

  constructor() {
    if (!this.canManage()) {
      this.loading.set(false);
      return;
    }
    this.settings.getSharing().subscribe({
      next: policy => this.reset(policy),
      error: () => this.loading.set(false),
    });
  }

  patch<K extends keyof SharingPolicyUpdate>(key: K, value: SharingPolicyUpdate[K]): void {
    const d = this.draft();
    if (d) {
      this.draft.set({ ...d, [key]: value });
    }
  }

  patchNumber(key: 'defaultLifetimeDays' | 'maxLifetimeDays' | 'minPasswordLength' | 'maxPasswordAttempts', raw: string | number): void {
    const value = Math.round(Number(raw));
    if (Number.isFinite(value)) {
      this.patch(key, value);
    }
  }

  save(): void {
    const d = this.draft();
    if (!d || this.saving()) {
      return;
    }
    const text = this.maxDownloadsText().trim();
    const maxDownloads = text ? Math.round(Number(text)) : null;
    if (maxDownloads !== null && !Number.isFinite(maxDownloads)) {
      this.toast.error('Maximum opens must be a whole number, or empty for no limit.');
      return;
    }
    this.saving.set(true);
    this.settings.updateSharing({ ...d, maxDownloads }).subscribe({
      next: policy => {
        this.saving.set(false);
        this.reset(policy);
        // El diálogo de compartir vuelve a leer las reglas nuevas.
        this.storagePolicy.invalidateSharing();
        this.toast.success('Sharing rules saved.');
      },
      error: err => {
        this.saving.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  private reset(policy: SharingPolicy): void {
    const { allowPublicShareLinks: _public, ...editable } = policy;
    this.draft.set(editable);
    this.maxDownloadsText.set(policy.maxDownloads === null ? '' : `${policy.maxDownloads}`);
    this.loading.set(false);
  }
}
