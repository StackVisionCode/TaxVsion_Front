import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { CheckRingComponent, CheckRingItem } from '@shared/ui/check-ring/check-ring.component';
import { observeActiveSection, scrollToSection } from '@shared/utils/scroll-spy.util';
import { ProfileStore } from '../../data-access/profile.store';
import { ProfileMfaStore } from '../../data-access/mfa.store';
import { TwoStepVerificationComponent } from '../../ui/two-step-verification/two-step-verification.component';
import {
  PASSWORD_MIN_LENGTH,
  UserSession,
  passwordStrength,
  roleDisplayName,
  sessionDeviceLabel,
  sessionIsMobile,
  sessionLocationLabel,
} from '../../data-access/profile.model';

/** Paso del flujo inline de cambio de email/teléfono. */
type ContactFlowStep = 'idle' | 'editing' | 'confirming';

type ToastKind = 'success' | 'error';

/** Secciones del índice lateral; el id es el ancla del `<section>`. */
interface ProfileSection {
  id: string;
  label: string;
  icon: string;
}

const STRENGTH_LABELS = ['Too short', 'Fair', 'Good', 'Strong', 'Excellent'] as const;

/**
 * Página del usuario logueado, respaldada por el servicio Auth real:
 *
 * - Nombre/apellido: PUT /auth/users/me/profile (el timeZoneId actual se preserva).
 * - Contraseña: POST /auth/password/change (revoca las demás sesiones).
 * - Email/teléfono: flujos request → código → confirm de CredentialsController.
 * - Sesiones: GET/DELETE /auth/sessions (revocar una o todas menos la actual).
 * - Verificación en dos pasos y dispositivos de confianza: `app-two-step-verification` (/auth/mfa/*).
 *
 * Cabecera con un chequeo de seguridad hecho solo con datos reales (email verificado, MFA, teléfono)
 * e índice lateral que sigue el scroll. No hay foto: el backend no tiene dónde guardarla.
 */
@Component({
  selector: 'app-profile-page',
  imports: [
    CommonModule,
    FormsModule,
    TwoStepVerificationComponent,
    AvatarComponent,
    StateBlockComponent,
    TimeAgoPipe,
    CheckRingComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.css',
})
export class ProfilePageComponent {
  private readonly auth = inject(AuthService);
  readonly store = inject(ProfileStore);
  private readonly mfa = inject(ProfileMfaStore);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------------------------
  // Identidad
  // ---------------------------------------------------------------------------
  private readonly user = this.auth.currentUser;
  readonly roleLabel = computed(() => roleDisplayName(this.user()?.actorType));
  readonly isAdminRole = computed(() => {
    const actor = this.user()?.actorType;
    return actor === 'TenantAdmin' || actor === 'PlatformAdmin';
  });
  readonly officeName = computed(() => this.user()?.tenant?.name ?? null);
  /** "America/Santo_Domingo" → "America · Santo Domingo". */
  readonly timeZoneLabel = computed(() => {
    const tz = this.user()?.timeZoneId;
    return tz ? tz.replace(/_/g, ' ').replace('/', ' · ') : null;
  });

  // Nombre/apellido: editables. Email y teléfono solo cambian vía sus flujos verificados.
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly email = computed(() => this.user()?.email ?? '');
  readonly phone = computed(() => this.user()?.phoneNumber ?? '');
  readonly emailVerified = computed(() => this.user()?.emailVerified ?? false);
  readonly phoneVerified = computed(() => this.user()?.phoneVerified ?? false);

  /** Nombre guardado (para la cabecera y para saber si hay cambios sin guardar). */
  readonly savedFullName = computed(() => `${this.user()?.name ?? ''} ${this.user()?.lastName ?? ''}`.trim());
  readonly profileDirty = computed(() => {
    const u = this.user();
    return (
      !!u && (this.firstName().trim() !== (u.name ?? '') || this.lastName().trim() !== (u.lastName ?? ''))
    );
  });

  // ---------------------------------------------------------------------------
  // Chequeo de seguridad (cabecera)
  // ---------------------------------------------------------------------------
  readonly securityChecks = computed<CheckRingItem[]>(() => [
    { id: 'email', label: 'Email verified', done: this.emailVerified(), target: 'personal' },
    { id: 'mfa', label: 'Two-step verification on', done: this.mfa.enabled(), target: 'two-step' },
    { id: 'phone', label: 'Phone number verified', done: !!this.phone() && this.phoneVerified(), target: 'personal' },
  ]);
  /** Hasta que llega el estado de MFA el puntaje sería falso: se muestra cargando. */
  readonly securityReady = this.mfa.loaded;
  readonly securityScore = computed(() => {
    const checks = this.securityChecks();
    return Math.round((checks.filter(c => c.done).length / checks.length) * 100);
  });
  readonly securityTone = computed<'strong' | 'good' | 'weak'>(() => {
    const score = this.securityScore();
    return score === 100 ? 'strong' : score >= 60 ? 'good' : 'weak';
  });
  readonly securityLabel = computed(() =>
    this.securityTone() === 'strong' ? 'Well protected' : this.securityTone() === 'good' ? 'Almost there' : 'Needs attention',
  );
  // ---------------------------------------------------------------------------
  // Índice lateral con seguimiento del scroll
  // ---------------------------------------------------------------------------
  readonly sections: ProfileSection[] = [
    { id: 'personal', label: 'Personal info', icon: 'person-outline' },
    { id: 'password', label: 'Password', icon: 'key-outline' },
    { id: 'two-step', label: 'Two-step verification', icon: 'shield-checkmark-outline' },
    { id: 'sessions', label: 'Active sessions', icon: 'desktop-outline' },
  ];
  readonly activeSection = signal('personal');

  constructor() {
    effect(() => {
      const u = this.user();
      if (!u) {
        return;
      }
      this.firstName.set(u.name ?? '');
      this.lastName.set(u.lastName ?? '');
    });
    this.store.loadSessions();

    // La sección "activa" es la que cruza la franja superior de la ventana.
    afterNextRender(() => {
      const stop = observeActiveSection(
        this.host.nativeElement as HTMLElement,
        this.sections.map(s => s.id),
        id => this.activeSection.set(id),
      );
      this.destroyRef.onDestroy(stop);
    });
  }

  scrollTo(sectionId: string): void {
    scrollToSection(this.host.nativeElement as HTMLElement, sectionId);
    this.activeSection.set(sectionId);
  }

  // ---------------------------------------------------------------------------
  // Información personal (PUT /auth/users/me/profile)
  // ---------------------------------------------------------------------------
  readonly savingProfile = signal(false);

  discardProfile(): void {
    this.firstName.set(this.user()?.name ?? '');
    this.lastName.set(this.user()?.lastName ?? '');
  }

  saveProfile(): void {
    const name = this.firstName().trim();
    const lastName = this.lastName().trim();
    if (!name || !lastName) {
      this.notify('First and last name are required', 'error');
      return;
    }
    this.savingProfile.set(true);
    this.store.saveProfile({ name, lastName }).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.notify('Profile updated', 'success');
      },
      error: err => {
        this.savingProfile.set(false);
        this.notify(toApiError(err).message, 'error');
      },
    });
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
        this.notify('Email updated', 'success');
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
        this.notify('Phone number verified', 'success');
      },
      error: err => {
        this.phoneBusy.set(false);
        this.phoneError.set(toApiError(err).message);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Contraseña (POST /auth/password/change)
  // ---------------------------------------------------------------------------
  readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly showPasswords = signal(false);
  readonly changingPassword = signal(false);

  readonly strength = computed(() => passwordStrength(this.newPassword()));
  readonly strengthLabel = computed(() => STRENGTH_LABELS[this.strength()]);
  readonly passwordRules = computed(() => {
    const next = this.newPassword();
    return [
      { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: next.length >= PASSWORD_MIN_LENGTH },
      { label: 'Different from your current password', met: !!next && next !== this.currentPassword() },
      { label: 'Both new passwords match', met: !!next && next === this.confirmPassword() },
    ];
  });
  readonly canUpdatePassword = computed(
    () => !!this.currentPassword() && this.passwordRules().every(rule => rule.met) && !this.changingPassword(),
  );

  updatePassword(): void {
    if (!this.canUpdatePassword()) {
      return;
    }
    this.changingPassword.set(true);
    this.store.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.notify('Password updated. Other devices were signed out.', 'success');
        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
        this.showPasswords.set(false);
      },
      error: err => {
        this.changingPassword.set(false);
        this.notify(toApiError(err).message, 'error');
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Sesiones activas (GET/DELETE /auth/sessions)
  // ---------------------------------------------------------------------------
  readonly revokingSessionId = signal<string | null>(null);
  readonly revokingOthers = signal(false);

  readonly currentSession = computed(
    () => this.store.sessions().find(s => s.id === this.store.currentSessionId()) ?? null,
  );
  readonly otherSessions = computed(() =>
    this.store.sessions().filter(s => s.id !== this.store.currentSessionId()),
  );

  deviceLabel(session: UserSession): string {
    return sessionDeviceLabel(session);
  }

  deviceIcon(session: UserSession): string {
    return sessionIsMobile(session) ? 'phone-portrait-outline' : 'desktop-outline';
  }

  locationLabel(session: UserSession): string | null {
    return sessionLocationLabel(session.ipAddress);
  }

  revokeSession(session: UserSession): void {
    this.revokingSessionId.set(session.id);
    this.store.revokeSession(session.id).subscribe({
      next: () => {
        this.revokingSessionId.set(null);
        this.notify('Session signed out', 'success');
      },
      error: err => {
        this.revokingSessionId.set(null);
        this.notify(toApiError(err).message, 'error');
      },
    });
  }

  signOutEverywhereElse(): void {
    this.revokingOthers.set(true);
    this.store.revokeOtherSessions().subscribe({
      next: () => {
        this.revokingOthers.set(false);
        this.notify('Signed out on all other devices', 'success');
      },
      error: err => {
        this.revokingOthers.set(false);
        this.notify(toApiError(err).message, 'error');
      },
    });
  }

  /** Feedback de las acciones de la página: toast global. */
  private notify(message: string, kind: ToastKind): void {
    if (kind === 'success') {
      this.toast.success(message);
    } else {
      this.toast.error(message);
    }
  }
}
