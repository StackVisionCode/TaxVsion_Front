import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/** Modos de preferencia de facturación. Decide si el banner ofrece "Pay now" o "Manage billing". */
export type BillingPreferenceMode = 'Automatic' | 'Manual';

/** Snapshot del backend. Mismo shape que el del landing — es el mismo endpoint. */
export interface BillingPreference {
  mode: BillingPreferenceMode;
  providerCode?: string | null;
  hasActiveMandate: boolean;
  acceptedAtUtc?: string | null;
  agreedAmountCents?: number | null;
  agreedCurrency?: string | null;
  agreedCadence?: string | null;
  defaultPaymentMethod?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
}

/** Cliente de `/subscriptions/me/billing-preference`. Lectura solamente desde el CRM. */
@Injectable({ providedIn: 'root' })
export class BillingPreferenceService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantBase();
  }

  get(): Observable<BillingPreference> {
    return this.http.get<BillingPreference>(`${this.base}/subscriptions/me/billing-preference`);
  }
}
