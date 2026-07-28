import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { Branding, InvoiceSummary, IssuerProfile, LineDraft, PaymentConfig } from './billing-live.model';

/**
 * Apartado de facturación en vivo (autenticado, sesión del tenant): métodos de pago (PaymentClient)
 * + facturas (Billing). El token del tenant lo adjunta el interceptor de auth.
 */
@Injectable({ providedIn: 'root' })
export class BillingLiveService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // --- Métodos de pago (PaymentClient) ---
  listConfigs(): Observable<PaymentConfig[]> {
    return this.http.get<PaymentConfig[]>(`${this.base}/payments-client/config`);
  }
  createConfig(body: {
    providerCode: string;
    mode: string;
    publishableKey: string;
    statementDescriptor: string;
  }): Observable<string> {
    return this.http.post<string>(`${this.base}/payments-client/config`, body);
  }
  setSecrets(provider: string, body: { secretKey: string; webhookSecret: string }): Observable<unknown> {
    return this.http.put(`${this.base}/payments-client/config/${provider}/secrets`, body);
  }
  activate(provider: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/config/${provider}/activate`, {});
  }
  deactivate(provider: string, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/config/${provider}/deactivate`, { reason });
  }

  // --- Branding del template de facturas (Documents) ---
  getBranding(): Observable<Branding> {
    return this.http.get<Branding>(`${this.base}/documents/branding`);
  }
  saveBranding(b: Branding): Observable<unknown> {
    return this.http.put(`${this.base}/documents/branding`, {
      displayName: b.displayName || null,
      logoDataUri: b.logoDataUri || null,
      brandColorHex: b.brandColorHex || null,
      footerText: b.footerText || null,
    });
  }

  // --- Perfil del emisor (empresa del tenant), guardado en el backend ---
  getIssuerProfile(): Observable<IssuerProfile & { website?: string | null }> {
    return this.http.get<IssuerProfile & { website?: string | null }>(`${this.base}/billing/issuer-profile`);
  }
  saveIssuerProfile(profile: IssuerProfile): Observable<unknown> {
    return this.http.put(`${this.base}/billing/issuer-profile`, {
      name: profile.name,
      taxId: profile.taxId || null,
      line1: profile.line1 || null,
      city: profile.city || null,
      state: profile.state || null,
      zip: profile.zip || null,
      country: profile.country || 'US',
      phone: profile.phone || null,
      email: profile.email || null,
      website: null,
    });
  }

  // --- Facturas (Billing) ---
  listInvoices(): Observable<InvoiceSummary[]> {
    return this.http.get<InvoiceSummary[]>(`${this.base}/billing/invoices`);
  }
  getInvoice(id: string): Observable<InvoiceSummary> {
    return this.http.get<InvoiceSummary>(`${this.base}/billing/invoices/${id}`);
  }
  issueInvoice(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/billing/invoices/${id}/issue`, {});
  }

  /** Registra un pago manual/offline (efectivo, cheque, transferencia…) → marca Paid. */
  recordManualPayment(id: string, method: string, amountCents?: number): Observable<unknown> {
    return this.http.post(`${this.base}/billing/invoices/${id}/record-payment`, {
      method,
      amountCents: amountCents ?? null,
      paidAtUtc: null,
    });
  }

  /** Pide a CloudStorage una URL de descarga temporal del PDF de la factura. */
  getDownloadUrl(fileId: string): Observable<{ fileId: string; downloadUrl: string; expiresAtUtc: string }> {
    return this.http.post<{ fileId: string; downloadUrl: string; expiresAtUtc: string }>(
      `${this.base}/storage/files/${fileId}/download-url`,
      {}
    );
  }

  /** Arma el body real (centavos / basis points) desde el form en dólares/%. Incluye el emisor
   * (empresa del tenant) si está configurado, para que aparezca en la factura. */
  createInvoice(
    customerName: string,
    customerTaxId: string,
    currency: string,
    lines: LineDraft[]
  ): Observable<{ invoiceId: string }> {
    // El emisor NO se manda: Billing estampa el perfil de empresa del tenant automáticamente.
    const body = {
      customer: {
        customerId: crypto.randomUUID(),
        name: customerName,
        email: null,
        phone: null,
        taxId: customerTaxId || null,
        billing: null,
      },
      currency,
      lines: lines.map(l => ({
        description: l.description,
        quantity: l.quantity,
        unitAmountCents: Math.round(l.unitAmount * 100),
        taxBasisPoints: Math.round(l.taxPercent * 100),
      })),
      notes: null,
      issuer: null,
    };
    return this.http.post<{ invoiceId: string }>(`${this.base}/billing/invoices`, body);
  }
}
