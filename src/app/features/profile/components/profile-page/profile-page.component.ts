import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { ProfileStore } from '../../data-access/profile.store';
import { TwoStepVerificationComponent } from '../../ui/two-step-verification/two-step-verification.component';
import {
  PASSWORD_MIN_LENGTH,
  UserSession,
  sessionDeviceLabel,
  sessionIsMobile,
} from '../../data-access/profile.model';

/** Paso del flujo inline de cambio de email/teléfono. */
type ContactFlowStep = 'idle' | 'editing' | 'confirming';

interface Toast {
  message: string;
  kind: 'success' | 'error';
}

/**
 * Página del módulo Profile (estilo "Aether"): tarjeta de encabezado con
 * avatar/rol + información personal + seguridad + sesiones activas. Es la página
 * del usuario logueado, respaldada por el servicio Auth real:
 *
 * - Nombre/apellido: PUT /auth/users/me/profile (el timeZoneId actual se preserva).
 * - Contraseña: POST /auth/password/change (revoca las demás sesiones).
 * - Email/teléfono: flujos request → código → confirm de CredentialsController.
 * - Sesiones: GET/DELETE /auth/sessions (revocar una o todas menos la actual).
 * - Verificación en dos pasos: sección propia (`app-two-step-verification`)
 *   sobre /auth/mfa/* — estado, alta TOTP, desactivar, regenerar códigos y
 *   dispositivos de confianza.
 *
 * La foto de avatar es solo una vista previa local: el backend aún no expone un
 * endpoint para subirla.
 */
@Component({
  selector: 'app-profile-page',
  imports: [CommonModule, FormsModule, TwoStepVerificationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './profile-page.component.html',
})
export class ProfilePageComponent {
  private readonly auth = inject(AuthService);
  readonly store = inject(ProfileStore);

  readonly isOwner = true;
  readonly avatarColor = 'bg-indigo-600';

  // Rol real del usuario de sesión (actorType de /auth/me).
  readonly roleLabel = computed(() => this.auth.currentUser()?.actorType ?? 'Usuario');

  // Nombre/apellido: editables (PUT /auth/users/me/profile). Email y teléfono se
  // muestran desde currentUser y solo cambian vía sus flujos verificados.
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly email = computed(() => this.auth.currentUser()?.email ?? '');
  readonly phone = computed(() => this.auth.currentUser()?.phoneNumber ?? '');
  readonly emailVerified = computed(() => this.auth.currentUser()?.emailVerified ?? false);
  readonly phoneVerified = computed(() => this.auth.currentUser()?.phoneVerified ?? false);

  constructor() {
    effect(() => {
      const u = this.auth.currentUser();
      if (!u) {
        return;
      }
      this.firstName.set(u.name ?? '');
      this.lastName.set(u.lastName ?? '');
    });
    this.store.loadSessions();
  }

  readonly fullName = computed(() => `${this.firstName()} ${this.lastName()}`.trim());

  readonly initials = computed(() => {
    const first = this.firstName().trim();
    const last = this.lastName().trim();
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
    }
    return (first || last || 'U').slice(0, 2).toUpperCase();
  });

  // ---------------------------------------------------------------------------
  // Avatar: SOLO vista previa local. No existe endpoint de backend para subir la
  // foto todavía, así que nada se persiste ni se afirma como "guardado".
  // ---------------------------------------------------------------------------
  readonly avatarPhotoUrl = signal<string | null>(null);

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.avatarPhotoUrl.set(reader.result as string);
    reader.readAsDataURL(file);
    input.value = '';
  }

  // ---------------------------------------------------------------------------
  // Información personal (PUT /auth/users/me/profile)
  // ---------------------------------------------------------------------------
  readonly savingProfile = signal(false);
  readonly profileToast = signal<Toast | null>(null);
  private profileToastTimer?: ReturnType<typeof setTimeout>;

  saveProfile(): void {
    const name = this.firstName().trim();
    const lastName = this.lastName().trim();
    if (!name || !lastName) {
      this.showProfileToast('First and last name are required', 'error');
      return;
    }
    this.savingProfile.set(true);
    this.store.saveProfile({ name, lastName }).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.showProfileToast('Profile updated', 'success');
      },
      error: err => {
        this.savingProfile.set(false);
        this.showProfileToast(toApiError(err).message, 'error');
      },
    });
  }

  private showProfileToast(message: string, kind: Toast['kind']): void {
    this.profileToast.set({ message, kind });
    clearTimeout(this.profileToastTimer);
    this.profileToastTimer = setTimeout(() => this.profileToast.set(null), 4000);
  }

  // ---------------------------------------------------------------------------
  // Cambio de email: request (token al correo nuevo) → confirm con ese token
  // ---------------------------------------------------------------------------
  readonly emailStep = signal<ContactFlowStep>('idle');
  readonly newEmail = signal('');
  readonly emailToken = signal('');
  readonly emailBusy = signal(false);
  readonly emailError = signal<string | null>(null);

  startEmailChange(): void {
    this.newEmail.set('');
    this.emailToken.set('');
    this.emailError.set(null);
    this.emailStep.set('editing');
  }

  cancelEmailChange(): void {
    this.emailStep.set('idle');
    this.emailError.set(null);
    this.emailBusy.set(false);
  }

  sendEmailChange(): void {
    const email = this.newEmail().trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.emailError.set('Enter a valid email address');
      return;
    }
    if (email === this.email().toLowerCase()) {
      this.emailError.set('New email must be different from the current one');
      return;
    }
    this.emailError.set(null);
    this.emailBusy.set(true);
    this.store.requestEmailChange(email).subscribe({
      next: () => {
        this.emailBusy.set(false);
        this.emailStep.set('confirming');
      },
      error: err => {
        this.emailBusy.set(false);
        this.emailError.set(toApiError(err).message);
      },
    });
  }

  confirmEmailChange(): void {
    const token = this.emailToken().trim();
    if (!token) {
      this.emailError.set('Enter the code we sent to your new email');
      return;
    }
    this.emailError.set(null);
    this.emailBusy.set(true);
    this.store.confirmEmailChange(token).subscribe({
      next: () => {
        this.emailBusy.set(false);
        this.emailStep.set('idle');
        this.showProfileToast('Email updated', 'success');
      },
      error: err => {
        this.emailBusy.set(false);
        this.emailError.set(toApiError(err).message);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Cambio/verificación de teléfono: request (OTP por SMS) → confirm con el código
  // ---------------------------------------------------------------------------
  readonly phoneStep = signal<ContactFlowStep>('idle');
  readonly newPhone = signal('');
  readonly phoneCode = signal('');
  readonly phoneBusy = signal(false);
  readonly phoneError = signal<string | null>(null);

  startPhoneChange(): void {
    this.newPhone.set(this.phone());
    this.phoneCode.set('');
    this.phoneError.set(null);
    this.phoneStep.set('editing');
  }

  cancelPhoneChange(): void {
    this.phoneStep.set('idle');
    this.phoneError.set(null);
    this.phoneBusy.set(false);
  }

  sendPhoneChange(): void {
    const phoneNumber = this.newPhone().trim();
    // Mismas reglas que RequestPhoneVerificationHandler: 7-20 chars, dígitos/+/-/espacio.
    if (phoneNumber.length < 7 || phoneNumber.length > 20 || !/^[\d+\- ]+$/.test(phoneNumber)) {
      this.phoneError.set('Enter a valid phone number (digits, +, - and spaces)');
      return;
    }
    this.phoneError.set(null);
    this.phoneBusy.set(true);
    this.store.requestPhoneChange(phoneNumber).subscribe({
      next: () => {
        this.phoneBusy.set(false);
        this.phoneStep.set('confirming');
      },
      error: err => {
        this.phoneBusy.set(false);
        this.phoneError.set(toApiError(err).message);
      },
    });
  }

  confirmPhoneChange(): void {
    const code = this.phoneCode().trim();
    if (!code) {
      this.phoneError.set('Enter the code we texted you');
      return;
    }
    this.phoneError.set(null);
    this.phoneBusy.set(true);
    this.store.confirmPhone(code).subscribe({
      next: () => {
        this.phoneBusy.set(false);
        this.phoneStep.set('idle');
        this.showProfileToast('Phone number verified', 'success');
      },
      error: err => {
        this.phoneBusy.set(false);
        this.phoneError.set(toApiError(err).message);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Seguridad: cambio de contraseña (POST /auth/password/change)
  // ---------------------------------------------------------------------------
  readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly changingPassword = signal(false);
  readonly passwordToast = signal<Toast | null>(null);
  private passwordToastTimer?: ReturnType<typeof setTimeout>;

  updatePassword(): void {
    if (!this.currentPassword() || !this.newPassword() || !this.confirmPassword()) {
      this.showPasswordToast('All password fields are required', 'error');
      return;
    }
    if (this.newPassword() !== this.confirmPassword()) {
      this.showPasswordToast('New password and confirmation do not match', 'error');
      return;
    }
    if (this.newPassword().length < PASSWORD_MIN_LENGTH) {
      this.showPasswordToast(`Password must contain at least ${PASSWORD_MIN_LENGTH} characters`, 'error');
      return;
    }
    this.changingPassword.set(true);
    this.store.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.showPasswordToast('Password updated successfully', 'success');
        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
      },
      error: err => {
        this.changingPassword.set(false);
        this.showPasswordToast(toApiError(err).message, 'error');
      },
    });
  }

  private showPasswordToast(message: string, kind: Toast['kind']): void {
    this.passwordToast.set({ message, kind });
    clearTimeout(this.passwordToastTimer);
    this.passwordToastTimer = setTimeout(() => this.passwordToast.set(null), 4000);
  }

  // ---------------------------------------------------------------------------
  // Sesiones activas (GET/DELETE /auth/sessions)
  // ---------------------------------------------------------------------------
  readonly revokingSessionId = signal<string | null>(null);
  readonly revokingOthers = signal(false);
  readonly sessionsToast = signal<Toast | null>(null);
  private sessionsToastTimer?: ReturnType<typeof setTimeout>;

  deviceLabel(session: UserSession): string {
    return sessionDeviceLabel(session);
  }

  deviceIcon(session: UserSession): string {
    return sessionIsMobile(session) ? 'phone-portrait-outline' : 'desktop-outline';
  }

  isCurrentSession(session: UserSession): boolean {
    return session.id === this.store.currentSessionId();
  }

  trackSession(_index: number, session: UserSession): string {
    return session.id;
  }

  revokeSession(session: UserSession): void {
    this.revokingSessionId.set(session.id);
    this.store.revokeSession(session.id).subscribe({
      next: () => {
        this.revokingSessionId.set(null);
        this.showSessionsToast('Session signed out', 'success');
      },
      error: err => {
        this.revokingSessionId.set(null);
        this.showSessionsToast(toApiError(err).message, 'error');
      },
    });
  }

  signOutEverywhereElse(): void {
    this.revokingOthers.set(true);
    this.store.revokeOtherSessions().subscribe({
      next: () => {
        this.revokingOthers.set(false);
        this.showSessionsToast('Signed out on all other devices', 'success');
      },
      error: err => {
        this.revokingOthers.set(false);
        this.showSessionsToast(toApiError(err).message, 'error');
      },
    });
  }

  private showSessionsToast(message: string, kind: Toast['kind']): void {
    this.sessionsToast.set({ message, kind });
    clearTimeout(this.sessionsToastTimer);
    this.sessionsToastTimer = setTimeout(() => this.sessionsToast.set(null), 4000);
  }
}
