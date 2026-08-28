import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toDataURL } from 'qrcode';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { SetupTotpResponse } from '@core/auth/mfa.model';
import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';
import { ProfileMfaStore } from '../../data-access/mfa.store';
import { RecoveryCodesPanelComponent } from '../recovery-codes-panel/recovery-codes-panel.component';

/**
 * Alta de MFA desde el perfil (TOTP): setup → escanear QR o clave manual →
 * confirmar el primer código → códigos de recuperación.
 *
 * No se reutiliza `MfaSetupPageComponent` (features/auth) a propósito: aquel es
 * una PÁGINA ruteada con su propio layout a pantalla completa que además cierra
 * el enrolamiento forzado del login (`auth.completeMfaEnrollment()`) y navega a
 * /checkout o /dashboard al terminar. Aquí hace falta un modal dentro del perfil
 * que al terminar solo refresque el estado. Lo que sí se reutiliza es la lógica
 * de datos (el mismo `MfaService` vía `ProfileMfaStore`) y el panel de códigos.
 */
@Component({
  selector: 'app-mfa-enroll-modal',
  imports: [CommonModule, FormsModule, ModalComponent, RecoveryCodesPanelComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mfa-enroll-modal.component.html',
  styleUrl: './mfa-enroll-modal.component.css',
})
export class MfaEnrollModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  /** MFA quedó activo (el store ya recargó el estado); el padre solo avisa al usuario. */
  @Output() enrolled = new EventEmitter<void>();

  private readonly store = inject(ProfileMfaStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly setup = signal<SetupTotpResponse | null>(null);
  /** Data URL del QR generado en cliente desde otpAuthUri; null si falla (queda la clave manual). */
  readonly qrDataUrl = signal<string | null>(null);
  readonly loadingSetup = signal(false);
  readonly setupError = signal<string | null>(null);

  readonly code = signal('');
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly recoveryCodes = signal<string[] | null>(null);

  /** El modal cambia de título al llegar al paso de códigos de recuperación. */
  readonly heading = computed(() =>
    this.recoveryCodes() ? 'Save your recovery codes' : 'Turn on two-step verification',
  );

  readonly subheading = computed(() =>
    this.recoveryCodes()
      ? "You won't be able to see these codes again"
      : 'Add this account to your authenticator app, then enter the code it generates',
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.start();
    }
  }

  /** Reinicia el flujo y pide un secreto nuevo cada vez que se abre el modal. */
  start(): void {
    this.setup.set(null);
    this.qrDataUrl.set(null);
    this.recoveryCodes.set(null);
    this.code.set('');
    this.formError.set(null);
    this.setupError.set(null);
    this.loadingSetup.set(true);

    this.store
      .setupTotp()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.setup.set(res);
          this.loadingSetup.set(false);
          toDataURL(res.otpAuthUri, { width: 200, margin: 1 })
            .then(url => this.qrDataUrl.set(url))
            .catch(() => this.qrDataUrl.set(null));
        },
        error: err => {
          this.loadingSetup.set(false);
          this.setupError.set(toApiError(err).message);
        },
      });
  }

  confirm(): void {
    const code = this.code().trim();
    if (!/^\d{6}$/.test(code)) {
      this.formError.set('Enter the 6-digit code from your authenticator app.');
      return;
    }
    this.formError.set(null);
    this.submitting.set(true);

    this.store
      .confirmTotp(code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: codes => {
          this.submitting.set(false);
          this.recoveryCodes.set(codes);
          this.enrolled.emit();
        },
        error: err => {
          this.submitting.set(false);
          this.formError.set(this.messageFor(err));
        },
      });
  }

  close(): void {
    this.closed.emit();
  }

  private messageFor(err: unknown): string {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'Auth.MfaInvalid':
        return 'Invalid code. Check your device clock and try again.';
      case 'Mfa.NotSetUp':
        return 'Setup expired. Close this window and start over.';
      case NETWORK_ERROR_CODE:
        return "We couldn't reach the server.";
      default:
        return apiError.message || "We couldn't confirm the code.";
    }
  }
}
