import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanResponse } from '../../data-access/onboarding.model';

/**
 * Tarjetas del catálogo público de planes (`GET /plans`).
 *
 * Muestra solo el precio mensual a propósito: aunque un plan liste `Yearly` en
 * `supportedBillingCycles`, el cobro de onboarding es siempre el precio base
 * mensual como cargo único (`mode: "payment"` en Stripe), así que un toggle
 * mensual/anual mentiría sobre lo que se está por cobrar. Tampoco hay trial ni
 * cupones en este flujo.
 */
@Component({
  selector: 'app-plan-picker',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './plan-picker.component.html',
})
export class PlanPickerComponent {
  @Input() plans: PlanResponse[] = [];
  @Input() selectedPlanId: string | null = null;
  @Output() planSelected = new EventEmitter<string>();

  formatPrice(usd: number): string {
    return usd.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: Number.isInteger(usd) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  formatStorage(bytes: number): string {
    const gb = bytes / 1024 ** 3;
    if (gb >= 1024) {
      return `${Math.round(gb / 1024)} TB`;
    }
    return gb >= 1 ? `${Math.round(gb)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
  }
}
