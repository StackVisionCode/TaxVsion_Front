import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  // Static "logged in" user identity — mirrors the navbar's Jordan Reyes.
  readonly isOwner = true;
  readonly roleLabel = 'Administrator';
  readonly avatarColor = 'bg-indigo-600';

  // Personal information fields
  readonly firstName = signal('Jordan');
  readonly lastName = signal('Reyes');
  readonly email = signal('jordan.reyes@taxvision.com');
  readonly phone = signal('(555) 214-7890');

  readonly fullName = computed(() => `${this.firstName()} ${this.lastName()}`.trim());

  readonly initials = computed(() => {
    const first = this.firstName().trim();
    const last = this.lastName().trim();
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
    }
    return (first || last || 'U').slice(0, 2).toUpperCase();
  });

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
