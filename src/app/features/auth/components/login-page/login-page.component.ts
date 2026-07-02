import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnInit,
  OnDestroy,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

type LoginStage = 'idle' | 'validating' | 'authenticating' | 'success' | 'redirecting';

/**
 * Puerto visual del login de CRMTAXPROFRONTEND. Sin conexión a autenticación real:
 * el envío del formulario solo simula las etapas de carga con temporizadores locales.
 * La lógica de negocio (LoginService, TokenService, MFA, conflicto de sesión) se
 * conecta más adelante, cuando se migre la feature `auth` completa (Tier 2).
 */
@Component({
  selector: 'app-login-page',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(3)]],
    rememberMe: [false],
  });

  readonly showPassword = signal(false);
  readonly isLoggingIn = signal(false);
  readonly isTransitioning = signal(false);
  readonly loginStage = signal<LoginStage>('idle');
  readonly formError = signal<string | null>(null);

  readonly currentYear = new Date().getFullYear();

  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;

  private videoCheckInterval: ReturnType<typeof setInterval> | undefined;

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.ensureVideoPlays();
  }

  @HostListener('window:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      this.ensureVideoPlays();
    }
  }

  ngOnInit(): void {
    this.videoCheckInterval = setInterval(() => this.ensureVideoPlays(), 1000);
  }

  ngAfterViewInit(): void {
    this.ensureVideoPlays();
  }

  ngOnDestroy(): void {
    if (this.videoCheckInterval) {
      clearInterval(this.videoCheckInterval);
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  ensureVideoPlays(): void {
    const video = this.videoElement?.nativeElement;
    if (video && (video.paused || video.ended)) {
      if (video.ended) {
        video.currentTime = 0;
      }
      video.play().catch(() => {
        // Autoplay puede ser bloqueado por el navegador; no es crítico para la demo visual.
      });
    }
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

    this.loginStage.set('validating');
    await this.delay(300);

    this.loginStage.set('authenticating');
    await this.delay(600);

    this.loginStage.set('success');
    await this.delay(500);

    this.loginStage.set('redirecting');
    this.isTransitioning.set(true);
    await this.delay(800);

    // Sin backend conectado todavía: se reinicia el formulario en vez de navegar.
    this.isTransitioning.set(false);
    this.isLoggingIn.set(false);
    this.loginStage.set('idle');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getLoginStageMessage(): string {
    switch (this.loginStage()) {
      case 'validating':
        return 'Validating credentials...';
      case 'authenticating':
        return 'Authenticating...';
      case 'success':
        return 'Login successful!';
      case 'redirecting':
        return 'Redirecting to dashboard...';
      default:
        return 'Sign In';
    }
  }

  getCurrentStageIndex(): number {
    const stages: LoginStage[] = ['validating', 'authenticating', 'success', 'redirecting'];
    return stages.indexOf(this.loginStage());
  }
}
