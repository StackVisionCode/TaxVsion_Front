import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';

/**
 * Página del módulo Profile (estilo "Aether"): tarjeta de encabezado con
 * avatar/rol + tarjeta de información personal + tarjeta de seguridad.
 * Es la página del usuario logueado (no un directorio de otros usuarios,
 * eso vive en User Management). Todo el estado es local a la página:
 * los cambios de nombre/email/teléfono y el cambio de contraseña son
 * simulados con toasts transitorios, sin persistencia real ni backend.
 * Los datos iniciales replican al usuario "Jordan Reyes" mostrado en el
 * navbar (mismas iniciales "JR" y mismo color de avatar) para que la app
 * se sienta consistente de punta a punta.
 */
@Component({
  selector: 'app-profile-page',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './profile-page.component.html',
})
export class ProfilePageComponent {
  private readonly auth = inject(AuthService);

  readonly isOwner = true;
  readonly avatarColor = 'bg-indigo-600';

  // Rol real del usuario de sesión (actorType de /auth/me).
  readonly roleLabel = computed(() => this.auth.currentUser()?.actorType ?? 'Usuario');

  // Datos personales: se inicializan con el usuario real (currentUser, de /auth/me) y
  // quedan escribibles para el form. El guardado real contra el backend es un TODO.
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly email = signal('');
  readonly phone = signal('');

  constructor() {
    effect(() => {
      const u = this.auth.currentUser();
      if (!u) {
        return;
      }
      this.firstName.set(u.name ?? '');
      this.lastName.set(u.lastName ?? '');
      this.email.set(u.email ?? '');
      this.phone.set(u.phoneNumber ?? '');
    });
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

  // Security fields (fake, no real crypto/API)
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');

  // Transient toasts
  readonly profileToast = signal<string | null>(null);
  readonly passwordToast = signal<{ message: string; kind: 'success' | 'error' } | null>(null);

  private profileToastTimer?: ReturnType<typeof setTimeout>;
  private passwordToastTimer?: ReturnType<typeof setTimeout>;

  saveProfile(): void {
    this.profileToast.set('Profile updated');
    clearTimeout(this.profileToastTimer);
    this.profileToastTimer = setTimeout(() => this.profileToast.set(null), 2500);
  }

  updatePassword(): void {
    if (!this.currentPassword() || !this.newPassword() || !this.confirmPassword()) {
      this.showPasswordToast('All password fields are required', 'error');
      return;
    }
    if (this.newPassword() !== this.confirmPassword()) {
      this.showPasswordToast('New password and confirmation do not match', 'error');
      return;
    }
    this.showPasswordToast('Password updated successfully', 'success');
    this.currentPassword.set('');
    this.newPassword.set('');
    this.confirmPassword.set('');
  }

  private showPasswordToast(message: string, kind: 'success' | 'error'): void {
    this.passwordToast.set({ message, kind });
    clearTimeout(this.passwordToastTimer);
    this.passwordToastTimer = setTimeout(() => this.passwordToast.set(null), 2500);
  }
}
