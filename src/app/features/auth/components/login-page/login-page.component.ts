import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

/**
 * Diseño visual adaptado de una plantilla de referencia (panel con gradiente +
 * tarjeta blanca flotante). Sin conexión a autenticación real: el envío del
 * formulario solo simula una carga breve con un temporizador local. La lógica
 * de negocio (LoginService, TokenService, MFA, conflicto de sesión) se conecta
 * más adelante, cuando se migre la feature `auth` completa (Tier 2).
 */
@Component({
  selector: 'app-login-page',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly showPassword = signal(false);
  readonly isLoggingIn = signal(false);
  readonly formError = signal<string | null>(null);

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Please complete all fields correctly.');
      return;
    }

    this.formError.set(null);
    void this.playLoginSequence();
  }

  private async playLoginSequence(): Promise<void> {
    this.isLoggingIn.set(true);
    await this.delay(900);
    // Sin backend conectado todavía: se reinicia el formulario en vez de navegar.
    this.isLoggingIn.set(false);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
