import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

type LoginPhase = 'idle' | 'verifying' | 'sinking' | 'loading' | 'fading';

/**
 * Diseño visual adaptado de una plantilla de referencia (panel con gradiente +
 * tarjeta blanca flotante). Sin conexión a autenticación real: al enviar, la
 * verificación es simulada y dispara la coreografía de salida — la tarjeta se
 * hunde, aparece un loader circular de bolitas, todo se desvanece y se navega
 * al dashboard. La lógica de negocio (LoginService, TokenService, MFA) se
 * conecta más adelante, cuando se migre la feature `auth` completa.
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
  private readonly router = inject(Router);

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly showPassword = signal(false);
  readonly formError = signal<string | null>(null);
  readonly isTyping = signal(false);

  /** Fase de la coreografía de salida del login. */
  readonly phase = signal<LoginPhase>('idle');
  readonly isLoggingIn = computed(() => this.phase() !== 'idle');
  /** La tarjeta queda hundida desde 'sinking' en adelante. */
  readonly isSunk = computed(() => this.phase() !== 'idle' && this.phase() !== 'verifying');
  readonly showLoader = computed(() => this.phase() === 'loading' || this.phase() === 'fading');

  readonly loaderDots = Array.from({ length: 8 });

  private typingTimeout: ReturnType<typeof setTimeout> | undefined;

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  onTyping(): void {
    this.isTyping.set(true);
    clearTimeout(this.typingTimeout);
    // La animación fluida sigue viva un momento después de la última tecla y luego se asienta.
    this.typingTimeout = setTimeout(() => this.isTyping.set(false), 800);
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
    // 1. Verificación simulada (spinner en el botón).
    this.phase.set('verifying');
    await this.delay(800);

    // 2. La tarjeta se hunde y desaparece.
    this.phase.set('sinking');
    await this.delay(500);

    // 3. Loader circular de bolitas a pantalla completa.
    this.phase.set('loading');
    await this.delay(1400);

    // 4. Todo se desvanece y entra el dashboard.
    this.phase.set('fading');
    await this.delay(400);
    await this.router.navigate(['/dashboard']);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
