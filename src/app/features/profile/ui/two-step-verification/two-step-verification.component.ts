import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { MfaMethodInfo, TrustedDeviceInfo } from '@core/auth/mfa.model';
import { toApiError } from '@core/models/api-error.model';
import { ProfileMfaStore } from '../../data-access/mfa.store';
import { sessionDeviceLabel, sessionIsMobile } from '../../data-access/profile.model';
import { MfaEnrollModalComponent } from '../mfa-enroll-modal/mfa-enroll-modal.component';
import { MfaPasswordModalComponent } from '../mfa-password-modal/mfa-password-modal.component';
import { RecoveryCodesPanelComponent } from '../recovery-codes-panel/recovery-codes-panel.component';

interface Toast {
  message: string;
  kind: 'success' | 'error';
}

/**
 * Sección "Two-step verification" de la página de perfil: estado real de MFA
 * (GET /auth/mfa/status) + activar (TOTP), desactivar, regenerar códigos de
 * recuperación y revocar dispositivos de confianza. Todo lo que se muestra
 * viene del backend; no hay datos simulados.
 *
 * Las acciones sensibles no se ejecutan en un clic: desactivar y regenerar
 * piden la contraseña actual (el backend la exige) y revocar un dispositivo
 * pasa por el `app-confirm-dialog` compartido.
 */
@Component({
  selector: 'app-two-step-verification',
  imports: [
    CommonModule,
    ModalComponent,
    ConfirmDialogComponent,
    MfaEnrollModalComponent,
    MfaPasswordModalComponent,
    RecoveryCodesPanelComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './two-step-verification.component.html',
  styleUrl: './two-step-verification.component.css',
})
export class TwoStepVerificationComponent {
  readonly store = inject(ProfileMfaStore);

  constructor() {
    this.store.load();
  }

  // ---------------------------------------------------------------------------
  // Feedback puntual (mismo patrón de píldora que el resto de la página)
  // ---------------------------------------------------------------------------
  readonly toast = signal<Toast | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  private showToast(message: string, kind: Toast['kind']): void {
    this.toast.set({ message, kind });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  // ---------------------------------------------------------------------------
  // Alta (POST /auth/mfa/totp/setup + /confirm)
  // ---------------------------------------------------------------------------
  readonly enrollOpen = signal(false);

  openEnroll(): void {
    this.enrollOpen.set(true);
  }

  closeEnroll(): void {
    this.enrollOpen.set(false);
  }

  onEnrolled(): void {
    this.showToast('Two-step verification is on', 'success');
  }

  // ---------------------------------------------------------------------------
  // Desactivar (POST /auth/mfa/disable — requiere contraseña)
  // ---------------------------------------------------------------------------
  readonly disableOpen = signal(false);
  readonly disableBusy = signal(false);
  readonly disableError = signal<string | null>(null);

  openDisable(): void {
    this.disableError.set(null);
    this.disableBusy.set(false);
    this.disableOpen.set(true);
  }

  cancelDisable(): void {
    this.disableOpen.set(false);
  }

  confirmDisable(password: string): void {
    this.disableBusy.set(true);
    this.disableError.set(null);
    this.store.disable(password).subscribe({
      next: () => {
        this.disableBusy.set(false);
        this.disableOpen.set(false);
        this.showToast('Two-step verification is off', 'success');
      },
      error: err => {
        this.disableBusy.set(false);
        this.disableError.set(toApiError(err).message);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Regenerar códigos (POST /auth/mfa/recovery-codes/regenerate — requiere contraseña)
  // ---------------------------------------------------------------------------
  readonly regenerateOpen = signal(false);
  readonly regenerateBusy = signal(false);
  readonly regenerateError = signal<string | null>(null);
  /** Códigos nuevos: se muestran una única vez y se descartan al cerrar. */
  readonly newCodes = signal<string[] | null>(null);

  openRegenerate(): void {
    this.regenerateError.set(null);
    this.regenerateBusy.set(false);
    this.regenerateOpen.set(true);
  }

  cancelRegenerate(): void {
    this.regenerateOpen.set(false);
  }

  confirmRegenerate(password: string): void {
    this.regenerateBusy.set(true);
    this.regenerateError.set(null);
    this.store.regenerateRecoveryCodes(password).subscribe({
      next: codes => {
        this.regenerateBusy.set(false);
        this.regenerateOpen.set(false);
        this.newCodes.set(codes);
      },
      error: err => {
        this.regenerateBusy.set(false);
        this.regenerateError.set(toApiError(err).message);
      },
    });
  }

  closeCodes(): void {
    this.newCodes.set(null);
  }

  // ---------------------------------------------------------------------------
  // Dispositivos de confianza (DELETE /auth/mfa/trusted-devices/{id})
  // ---------------------------------------------------------------------------
  readonly pendingRevoke = signal<TrustedDeviceInfo | null>(null);
  readonly revokingId = signal<string | null>(null);

  readonly revokeMessage = computed(() => {
    const device = this.pendingRevoke();
    if (!device) {
      return '';
    }
    return `${this.deviceLabel(device)} will have to complete two-step verification again the next time it signs in.`;
  });

  askRevoke(device: TrustedDeviceInfo): void {
    this.pendingRevoke.set(device);
  }

  cancelRevoke(): void {
    this.pendingRevoke.set(null);
  }

  confirmRevoke(): void {
    const device = this.pendingRevoke();
    if (!device) {
      return;
    }
    this.pendingRevoke.set(null);
    this.revokingId.set(device.id);
    this.store.revokeTrustedDevice(device.id).subscribe({
      next: () => {
        this.revokingId.set(null);
        this.showToast('Device removed', 'success');
      },
      error: err => {
        this.revokingId.set(null);
        this.showToast(toApiError(err).message, 'error');
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Presentación
  // ---------------------------------------------------------------------------
  deviceLabel(device: TrustedDeviceInfo): string {
    return sessionDeviceLabel({ deviceName: null, userAgent: device.userAgent });
  }

  deviceIcon(device: TrustedDeviceInfo): string {
    return sessionIsMobile({ userAgent: device.userAgent })
      ? 'phone-portrait-outline'
      : 'desktop-outline';
  }

  methodLabel(method: MfaMethodInfo): string {
    switch (method.type) {
      case 'Totp':
        return 'Authenticator app';
      case 'Email':
        return 'Email code';
      case 'Sms':
        return 'Text message';
      default:
        return method.type;
    }
  }

  methodIcon(method: MfaMethodInfo): string {
    switch (method.type) {
      case 'Totp':
        return 'phone-portrait-outline';
      case 'Email':
        return 'mail-outline';
      case 'Sms':
        return 'chatbubble-ellipses-outline';
      default:
        return 'shield-checkmark-outline';
    }
  }
}
