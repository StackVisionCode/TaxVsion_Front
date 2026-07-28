import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { CheckoutIntentService } from '@core/billing/checkout-intent.service';
import { SignupStore } from '../../data-access/signup.store';
import { SignupPlan, SignupStep } from '../../data-access/signup.model';

/**
 * Wizard de alta self-service. Paso 1: elegir plan (GET /plans). Paso 2: datos de la cuenta →
 * aprovisiona el tenant real (reservar subdominio → crear tenant → aceptar invitación → login →
 * términos). Paso 3: cuenta lista → continúa al enrolamiento MFA (página existente) → dashboard.
 * El pago del plan elegido se completa después de entrar (checkout).
 */
@Component({
  selector: 'app-signup-page',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './signup-page.component.html',
})
export class SignupPageComponent implements OnInit {
  readonly store = inject(SignupStore);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly checkoutIntent = inject(CheckoutIntentService);

  /** El tenant exige enrolar MFA (policy). Con MFA opt-in queda en false y se salta ese paso. */
  readonly needsMfa = this.auth.mustEnrollMfa;

  readonly form: FormGroup = this.fb.group({
    companyName: ['', [Validators.required, Validators.minLength(2)]],
    subdomain: [
      '',
      [Validators.required, Validators.pattern(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/)],
    ],
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    acceptTerms: [false, [Validators.requiredTrue]],
  });

  /** Índice del paso actual para la barra de progreso. */
  readonly stepIndex = computed<number>(() => {
    const order: SignupStep[] = ['plan', 'account', 'done'];
    return order.indexOf(this.store.step());
  });

  ngOnInit(): void {
    this.store.loadPlans();
  }

  selectPlan(plan: SignupPlan): void {
    this.store.selectPlan(plan);
  }

  /** Deriva el subdominio del nombre de empresa mientras el usuario no lo haya editado a mano. */
  deriveSubdomain(): void {
    const sub = this.form.controls['subdomain'];
    if (sub.dirty) return;
    const name = (this.form.controls['companyName'].value ?? '') as string;
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
    sub.setValue(slug);
    this.store.checkSubdomain(slug);
  }

  onSubdomainInput(): void {
    this.store.checkSubdomain((this.form.controls['subdomain'].value ?? '') as string);
  }

  priceFor(plan: SignupPlan): number {
    const cycle = this.store.billingCycle();
    return plan.pricesUsdByCycle?.[cycle] ?? plan.monthlyPriceUsd;
  }

  gbOf(bytes: number): number {
    return Math.round(bytes / 1024 ** 3);
  }

  submitAccount(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.store.submitAccount({
      companyName: v.companyName,
      subdomain: v.subdomain,
      email: v.email,
      firstName: v.firstName,
      lastName: v.lastName,
      password: v.password,
    });
  }

  /** Siguiente paso tras crear la cuenta: MFA si el tenant lo exige; si no, directo al pago/dashboard. */
  continueAfterSignup(): void {
    if (this.needsMfa()) {
      void this.router.navigateByUrl('/login/setup-mfa');
      return;
    }
    void this.router.navigateByUrl(this.checkoutIntent.intent() ? '/checkout' : '/dashboard');
  }
}
