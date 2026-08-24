import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { OnboardingStore } from '../../data-access/onboarding.store';
import { OnboardingPlan, OnboardingStep } from '../../data-access/onboarding.model';

/**
 * Wizard pago-primero (PayFlow). Contacto → OTP de email → plan → códigos+pago. El comprador paga el
 * NETO en Stripe (o queda cubierto 100% por un código, sin cobro) y recibe por email el link de
 * registro. Estilo consistente con el wizard self-serve (features/signup).
 */
@Component({
  selector: 'app-onboarding-page',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './onboarding-page.component.html',
})
export class OnboardingPageComponent implements OnInit {
  readonly store = inject(OnboardingStore);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  readonly contactForm: FormGroup = this.fb.group({
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
  });

  readonly otpForm: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{4,8}$/)]],
  });

  readonly codesForm: FormGroup = this.fb.group({
    referralCode: [''],
    promoCode: [''],
    giftCode: [''],
  });

  /** Índice del paso actual para la barra de progreso. */
  readonly stepIndex = computed<number>(() => {
    const order: OnboardingStep[] = ['contact', 'otp', 'plan', 'pay', 'done'];
    return order.indexOf(this.store.step());
  });

  ngOnInit(): void {
    // Retorno desde Stripe (?status=success|cancel). Prefija el referido desde ?ref= si vino en el link.
    const status = this.route.snapshot.queryParamMap.get('status');
    if (status) this.store.applyReturnStatus(status);
    const ref = this.route.snapshot.queryParamMap.get('ref');
    if (ref) this.codesForm.patchValue({ referralCode: ref });
    this.applyPreselectedPlan();
  }

  /**
   * Plan elegido antes de entrar (modal de "Sign up"): llega como `?plan=<id>&cycle=`.
   * El catálogo se pide igual porque el paso de plan lo muestra, pero al llegar ahí el
   * plan ya está marcado y solo hay que confirmarlo. Un id que no exista se ignora en
   * silencio: el usuario elige de nuevo en su paso, sin ver un error que no le aporta.
   */
  private applyPreselectedPlan(): void {
    const planId = this.route.snapshot.queryParamMap.get('plan');
    if (!planId) {
      return;
    }

    const cycle = this.route.snapshot.queryParamMap.get('cycle');
    if (cycle === 'Monthly' || cycle === 'Yearly') {
      this.store.setBillingCycle(cycle);
    }

    // El store marca el plan en cuanto llega el catálogo (una sola vez: si el usuario
    // luego cambia de opción en su paso, nada la revierte).
    this.store.loadPlansThen(planId);
  }

  submitContact(): void {
    if (this.contactForm.invalid) {
      this.contactForm.markAllAsTouched();
      return;
    }
    const v = this.contactForm.getRawValue();
    this.store.startContact({
      email: v.email,
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone,
    });
  }

  submitOtp(): void {
    if (this.otpForm.invalid) {
      this.otpForm.markAllAsTouched();
      return;
    }
    this.store.verifyOtp((this.otpForm.controls['code'].value as string).trim());
  }

  selectPlan(plan: OnboardingPlan): void {
    this.store.selectPlan(plan);
  }

  submitPay(): void {
    const v = this.codesForm.getRawValue();
    this.store.pay({
      referralCode: v.referralCode,
      promoCode: v.promoCode,
      giftCode: v.giftCode,
    });
  }

  priceFor(plan: OnboardingPlan): number {
    const cycle = this.store.billingCycle();
    return plan.pricesUsdByCycle?.[cycle] ?? plan.monthlyPriceUsd;
  }

  /** Cents → dólares. */
  dollars(cents: number | null | undefined): number {
    return (cents ?? 0) / 100;
  }

  gbOf(bytes: number): number {
    return Math.round(bytes / 1024 ** 3);
  }
}
