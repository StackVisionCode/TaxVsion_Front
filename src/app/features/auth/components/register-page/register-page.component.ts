import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

type RegisterPhase = 'idle' | 'creating' | 'done';

/** Campos que valida cada paso antes de avanzar. */
const STEP_CONTROLS: string[][] = [
  ['firstName', 'lastName', 'email', 'phone'],
  ['businessName'],
  ['password', 'confirmPassword', 'acceptTerms'],
];

/**
 * Página de registro (mismo lenguaje visual que el login: tarjeta blanca
 * flotante con panel de gradiente a la izquierda). Adaptación del register
 * multi-paso del CRM original — datos personales → firma → contraseña y
 * términos — sin el paso de pago (los flujos de pago quedan fuera de alcance
 * en toda la app). Sin backend: "crear la cuenta" es una simulación que
 * termina en una vista de éxito con enlace al login.
 */
@Component({
  selector: 'app-register-page',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './register-page.component.html',
  styleUrl: './register-page.component.css',
})
export class RegisterPageComponent {
  private readonly fb = inject(FormBuilder);

  form: FormGroup = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    businessName: ['', Validators.required],
    description: [''],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
    acceptTerms: [false, Validators.requiredTrue],
  });

  readonly stepTitles = ['Personal information', 'Your firm', 'Secure your account'];
  readonly totalSteps = this.stepTitles.length;

  readonly currentStep = signal(1);
  readonly formError = signal<string | null>(null);
  readonly showPassword = signal(false);

  readonly phase = signal<RegisterPhase>('idle');
  readonly isCreating = computed(() => this.phase() === 'creating');
  readonly isDone = computed(() => this.phase() === 'done');

  readonly stepTitle = computed(() => this.stepTitles[this.currentStep() - 1]);

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  /** Valida solo los controles del paso actual; marca touched y frena si hay errores. */
  private stepIsValid(step: number): boolean {
    const controls = STEP_CONTROLS[step - 1];
    let valid = true;
    for (const name of controls) {
      const control = this.form.get(name);
      control?.markAsTouched();
      if (control?.invalid) {
        valid = false;
      }
    }
    return valid;
  }

  nextStep(): void {
    if (!this.stepIsValid(this.currentStep())) {
      this.formError.set('Please complete all fields correctly.');
      return;
    }
    this.formError.set(null);
    this.currentStep.update(step => Math.min(this.totalSteps, step + 1));
  }

  prevStep(): void {
    this.formError.set(null);
    this.currentStep.update(step => Math.max(1, step - 1));
  }

  onSubmit(): void {
    if (!this.stepIsValid(this.totalSteps)) {
      this.formError.set('Please complete all fields correctly.');
      return;
    }
    if (this.form.value.password !== this.form.value.confirmPassword) {
      this.formError.set('Passwords do not match.');
      return;
    }
    this.formError.set(null);

    // Creación simulada: spinner breve y vista de éxito (sin backend).
    this.phase.set('creating');
    setTimeout(() => this.phase.set('done'), 1200);
  }
}
