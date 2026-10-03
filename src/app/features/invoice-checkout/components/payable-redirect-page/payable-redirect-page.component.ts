import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * Safety net for stable invoice URLs when infrastructure accidentally routes
 * `/payments-client/invoices/{reference}` to the SPA instead of PaymentClient.
 *
 * The canonical flow is still backend-owned:
 *   stable URL -> PaymentClient resolver -> 302 -> /pay/{checkoutToken}
 *
 * If this component ever renders, it means the SPA caught the navigation. We
 * hand the browser back to the system API so PaymentClient can perform the real
 * resolve/redirect without duplicating payment logic in the frontend.
 */
@Component({
  selector: 'app-payable-redirect-page',
  standalone: true,
  template: `
    <main class="min-h-screen w-full flex items-center justify-center bg-indigo-50 p-6">
      <section class="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl shadow-brand-light/30">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-light/20 text-2xl font-bold text-brand-bold">
          $
        </div>
        <h1 class="mt-5 text-2xl font-bold text-brand-bold">Preparing secure checkout</h1>
        <p class="mt-2 text-sm text-gray-500">We are opening the current payment link for this invoice.</p>
      </section>
    </main>
  `,
})
export class PayableRedirectPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiConfigService);

  ngOnInit(): void {
    const reference = this.route.snapshot.paramMap.get('reference')?.trim();
    if (!reference) {
      window.location.replace('/pay/missing?unavailable=Payable.NotFound');
      return;
    }

    window.location.replace(this.api.systemUrl(`/payments-client/invoices/${encodeURIComponent(reference)}`));
  }
}
