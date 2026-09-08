import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  BillingCatalogItem,
  BillingCustomerSummary,
  CatalogPage,
  CreateInvoiceRequest,
  CreateInvoiceResult,
  CreatePaymentLinkResult,
  InvoiceBranding,
  InvoiceLineDraft,
  InvoiceSummary,
  IssueInvoiceResult,
  IssuerProfile,
  PaymentConfig,
  PaymentLink,
  PaymentLinkStatus,
  PaymentPurposeKind,
  toBasisPoints,
  toCents,
} from './billing.model';

/**
 * Cliente HTTP de la sección de facturación. Toca tres servicios del Gateway, todos con el mismo
 * token de tenant que adjunta el interceptor de auth:
 *
 * - `/billing` — facturas y perfil del emisor (Billing.Api)
 * - `/payments-client` — proveedor de cobro y links de pago (PaymentClient.Api)
 * - `/documents/branding`, `/storage/files/...`, `/customers`, `/catalog/items` — apoyo
 *
 * Solo HTTP: ni estado ni transformaciones de presentación (eso es del store).
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantBase();
  }

  // ---------- Facturas ----------

  /**
   * `GET /billing/invoices?take=N`. Devuelve un ARRAY plano, no un PagedResult: el endpoint no
   * pagina ni filtra, solo recorta. Sin `take` el controller bindea 0 y no vuelve nada, así que
   * siempre se manda.
   */
  listInvoices(take: number): Observable<InvoiceSummary[]> {
    const params = new HttpParams().set('take', take);
    return this.http.get<InvoiceSummary[]>(`${this.base}/billing/invoices`, { params });
  }

  getInvoice(invoiceId: string): Observable<InvoiceSummary> {
    return this.http.get<InvoiceSummary>(`${this.base}/billing/invoices/${invoiceId}`);
  }

  /**
   * `POST /billing/invoices`. Convierte el borrador de la UI (dólares y %) al contrato
   * (centavos y puntos básicos). `issuer: null` a propósito: Billing estampa solo el perfil de
   * empresa guardado en `/billing/issuer-profile`.
   */
  createInvoice(
    customer: BillingCustomerSummary,
    customerTaxId: string,
    currency: string,
    lines: InvoiceLineDraft[],
    notes: string,
  ): Observable<CreateInvoiceResult> {
    const body: CreateInvoiceRequest = {
      customer: {
        customerId: customer.id,
        name: customer.displayName,
        email: customer.primaryEmail || null,
        phone: customer.primaryPhone,
        taxId: customerTaxId.trim() || null,
        billing: null,
      },
      currency,
      lines: lines.map(line => ({
        description: line.description.trim(),
        quantity: Math.max(1, Math.trunc(line.quantity || 0)),
        unitAmountCents: toCents(line.unitAmount),
        taxBasisPoints: toBasisPoints(line.taxPercent),
        catalogItemId: line.catalogItemId,
      })),
      notes: notes.trim() || null,
      issuer: null,
    };
    return this.http.post<CreateInvoiceResult>(`${this.base}/billing/invoices`, body);
  }

  /** `POST .../issue` — asigna el número definitivo y dispara link de cobro + PDF (asíncronos). */
  issueInvoice(invoiceId: string): Observable<IssueInvoiceResult> {
    return this.http.post<IssueInvoiceResult>(`${this.base}/billing/invoices/${invoiceId}/issue`, {});
  }

  /**
   * `POST .../record-payment` — cobro offline. Con `amountCents` menor al total el backend deja la
   * factura en `PartiallyPaid`; con null cobra el total. `paidAtUtc: null` → ahora.
   */
  recordPayment(invoiceId: string, method: string, amountCents: number | null): Observable<unknown> {
    return this.http.post(`${this.base}/billing/invoices/${invoiceId}/record-payment`, {
      method,
      amountCents,
      paidAtUtc: null,
    });
  }

  // ---------- Perfil del emisor ----------

  getIssuerProfile(): Observable<IssuerProfile> {
    return this.http.get<IssuerProfile>(`${this.base}/billing/issuer-profile`);
  }

  /** `PUT /billing/issuer-profile` → 204. Solo `name` es obligatorio; el resto viaja como null. */
  saveIssuerProfile(profile: IssuerProfile): Observable<unknown> {
    return this.http.put(`${this.base}/billing/issuer-profile`, {
      name: profile.name.trim(),
      taxId: profile.taxId || null,
      line1: profile.line1 || null,
      city: profile.city || null,
      state: profile.state || null,
      zip: profile.zip || null,
      country: profile.country || 'US',
      phone: profile.phone || null,
      email: profile.email || null,
      website: profile.website || null,
    });
  }

  // ---------- Marca del PDF ----------

  getBranding(): Observable<InvoiceBranding> {
    return this.http.get<InvoiceBranding>(`${this.base}/documents/branding`);
  }

  saveBranding(branding: InvoiceBranding): Observable<unknown> {
    return this.http.put(`${this.base}/documents/branding`, {
      displayName: branding.displayName || null,
      logoDataUri: branding.logoDataUri || null,
      brandColorHex: branding.brandColorHex || null,
      footerText: branding.footerText || null,
    });
  }

  // ---------- Proveedor de cobro ----------

  listPaymentConfigs(): Observable<PaymentConfig[]> {
    return this.http.get<PaymentConfig[]>(`${this.base}/payments-client/config`);
  }

  createPaymentConfig(body: {
    providerCode: string;
    mode: string;
    publishableKey: string;
    statementDescriptor: string;
  }): Observable<string> {
    return this.http.post<string>(`${this.base}/payments-client/config`, body);
  }

  setPaymentSecrets(provider: string, body: { secretKey: string; webhookSecret: string }): Observable<unknown> {
    return this.http.put(`${this.base}/payments-client/config/${provider}/secrets`, body);
  }

  activateProvider(provider: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/config/${provider}/activate`, {});
  }

  deactivateProvider(provider: string, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/config/${provider}/deactivate`, { reason });
  }

  // ---------- Links de pago ----------

  /**
   * `GET /payments-client/payment-links` — acá la paginación SÍ es real (`page`/`pageSize`),
   * a diferencia del listado de facturas. Devuelve un array plano.
   */
  listPaymentLinks(status: PaymentLinkStatus | null, page: number, pageSize: number): Observable<PaymentLink[]> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<PaymentLink[]>(`${this.base}/payments-client/payment-links`, { params });
  }

  /**
   * `POST /payments-client/payment-links`. `expiration` viaja con el formato TimeSpan de .NET
   * (`[d.]hh:mm:ss`); el dominio rechaza ≤ 0 y > 30 días.
   */
  createPaymentLink(body: {
    amountCents: number;
    currency: string;
    purposeKind: PaymentPurposeKind;
    purposeExternalReferenceId: string | null;
    expiration: string;
  }): Observable<CreatePaymentLinkResult> {
    return this.http.post<CreatePaymentLinkResult>(`${this.base}/payments-client/payment-links`, {
      taxpayerId: null,
      ...body,
    });
  }

  revokePaymentLink(paymentLinkId: string, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/payment-links/${paymentLinkId}/revoke`, { reason });
  }

  // ---------- Apoyo: clientes y catálogo ----------

  /** `GET /customers` — el picker de la factura necesita el GUID real del maestro Customer. */
  searchCustomers(term: string, size = 20): Observable<BillingCustomerSummary[]> {
    let params = new HttpParams().set('status', 'NotArchived').set('size', size);
    if (term.trim()) {
      params = params.set('term', term.trim());
    }
    return this.http
      .get<{ items: BillingCustomerSummary[] }>(`${this.base}/customers`, { params })
      .pipe(map(result => result.items ?? []));
  }

  /**
   * `GET /catalog/items` — productos y servicios para rellenar una línea. Catalog usa su propio
   * paginado (`page`/`pageSize`) y devuelve `{items, total, page, pageSize}`.
   */
  searchCatalogItems(search: string, pageSize = 20): Observable<BillingCatalogItem[]> {
    let params = new HttpParams().set('activeOnly', true).set('page', 1).set('pageSize', pageSize);
    if (search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http
      .get<CatalogPage<BillingCatalogItem>>(`${this.base}/catalog/items`, { params })
      .pipe(map(result => result.items ?? []));
  }

  /** URL temporal de descarga del PDF en CloudStorage. */
  getDownloadUrl(fileId: string): Observable<{ fileId: string; downloadUrl: string; expiresAtUtc: string }> {
    return this.http.post<{ fileId: string; downloadUrl: string; expiresAtUtc: string }>(
      `${this.base}/storage/files/${fileId}/download-url`,
      {},
    );
  }
}
