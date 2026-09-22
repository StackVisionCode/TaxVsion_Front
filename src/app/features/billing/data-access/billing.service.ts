import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import {
  BillingCatalogItem,
  CatalogPage,
  CreateInvoiceRequest,
  CreateInvoiceResult,
  CreatePaymentLinkResult,
  InvoiceBranding,
  InvoiceDetail,
  InvoiceLineDraft,
  InvoiceLineInput,
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
    customer: CustomerSummary,
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
      lines: this.toLineInputs(lines),
      notes: notes.trim() || null,
      issuer: null,
    };
    return this.http.post<CreateInvoiceResult>(`${this.base}/billing/invoices`, body);
  }

  /** `GET /billing/invoices/{id}/detail` — cliente + líneas para prellenar la edición. */
  getInvoiceDetail(invoiceId: string): Observable<InvoiceDetail> {
    return this.http.get<InvoiceDetail>(`${this.base}/billing/invoices/${invoiceId}/detail`);
  }

  /** `PUT /billing/invoices/{id}` — edita borrador o emitida sin pagos (recalcula, reconcilia stock). */
  updateInvoice(
    invoiceId: string,
    customer: CustomerSummary,
    customerTaxId: string,
    currency: string,
    lines: InvoiceLineDraft[],
    notes: string,
  ): Observable<void> {
    const body = {
      customer: {
        customerId: customer.id,
        name: customer.displayName,
        email: customer.primaryEmail || null,
        phone: customer.primaryPhone,
        taxId: customerTaxId.trim() || null,
        billing: null,
      },
      currency,
      lines: this.toLineInputs(lines),
      notes: notes.trim() || null,
    };
    return this.http.put<void>(`${this.base}/billing/invoices/${invoiceId}`, body);
  }

  /** `DELETE /billing/invoices/{id}` — borra (soft) un BORRADOR. Emitida/pagada → usar void. */
  deleteInvoice(invoiceId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/billing/invoices/${invoiceId}`);
  }

  /** `POST /billing/invoices/{id}/void` — anula una emitida/pagada y repone el stock. */
  voidInvoice(invoiceId: string, reason: string | null): Observable<void> {
    return this.http.post<void>(`${this.base}/billing/invoices/${invoiceId}/void`, { reason });
  }

  /** Convierte líneas de la UI (dólares y %) al contrato (centavos y puntos básicos). */
  private toLineInputs(lines: InvoiceLineDraft[]): InvoiceLineInput[] {
    return lines.map(line => ({
      description: line.description.trim(),
      quantity: Math.max(1, Math.trunc(line.quantity || 0)),
      unitAmountCents: toCents(line.unitAmount),
      taxBasisPoints: toBasisPoints(line.taxPercent),
      catalogItemId: line.catalogItemId,
    }));
  }

  /** `POST .../issue` — asigna el número definitivo y dispara link de cobro + PDF (asíncronos). */
  issueInvoice(invoiceId: string): Observable<IssueInvoiceResult> {
    return this.http.post<IssueInvoiceResult>(`${this.base}/billing/invoices/${invoiceId}/issue`, {});
  }

  /**
   * `GET /inventory/stock/{catalogItemId}` — para avisar en el formulario cuando la cantidad supera el
   * stock disponible (el bloqueo real es al emitir). Devuelve `null` ante 404 (sin nivel), 403 (sin
   * permiso de inventario) o cualquier error: en esos casos no se muestra aviso.
   */
  getStockLevel(catalogItemId: string): Observable<{ quantityOnHand: number; isTracked: boolean } | null> {
    return this.http
      .get<{ quantityOnHand: number; isTracked: boolean }>(`${this.base}/inventory/stock/${catalogItemId}`)
      .pipe(catchError(() => of(null)));
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
    apiBaseUrl?: string | null;
  }): Observable<string> {
    return this.http.post<string>(`${this.base}/payments-client/config`, body);
  }

  setPaymentSecrets(provider: string, body: { secretKey: string; webhookSecret: string }): Observable<unknown> {
    return this.http.put(`${this.base}/payments-client/config/${provider}/secrets`, body);
  }

  /** `PUT /payments-client/config/{provider}/url` — edita la URL/endpoint del proveedor. */
  updateProviderUrl(provider: string, apiBaseUrl: string | null): Observable<unknown> {
    return this.http.put(`${this.base}/payments-client/config/${provider}/url`, { apiBaseUrl });
  }

  activateProvider(provider: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/config/${provider}/activate`, {});
  }

  deactivateProvider(provider: string, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/payments-client/config/${provider}/deactivate`, { reason });
  }

  /** `DELETE /payments-client/config/{provider}` — elimina la config por completo (corregir un alta errónea). */
  deleteProvider(provider: string): Observable<unknown> {
    return this.http.delete(`${this.base}/payments-client/config/${provider}`);
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

  /**
   * `POST /notifications/email/send` — envía la factura al cliente por correo con el PDF adjunto
   * (`attachmentFileIds` son ids de CloudStorage, = `pdfFileId`). Es asíncrono (202): el servicio de
   * correo lo entrega fuera del request. Usa el JWT del usuario (permiso `notification.email.send`).
   */
  sendInvoiceEmail(input: {
    invoiceNumber: string | null;
    email: string;
    name: string | null;
    pdfFileId: string;
    checkoutUrl?: string | null;
  }): Observable<void> {
    const number = input.invoiceNumber ?? '';
    const payLink = input.checkoutUrl
      ? `<p>You can pay online here: <a href="${input.checkoutUrl}">${input.checkoutUrl}</a></p>`
      : '';
    const body = {
      subject: `Invoice ${number}`.trim(),
      htmlBody:
        `<p>Hello ${input.name ?? ''},</p>` +
        `<p>Please find attached your invoice ${number}.</p>` +
        payLink +
        `<p>Thank you.</p>`,
      textBody:
        `Please find attached your invoice ${number}.` +
        (input.checkoutUrl ? ` Pay online: ${input.checkoutUrl}` : ''),
      priority: 'Normal',
      recipients: [{ address: input.email, kind: 'To', name: input.name }],
      attachmentFileIds: [input.pdfFileId],
    };
    return this.http.post<void>(`${this.base}/notifications/email/send`, body);
  }

  /** URL temporal de descarga del PDF en CloudStorage. */
  getDownloadUrl(fileId: string): Observable<{ fileId: string; downloadUrl: string; expiresAtUtc: string }> {
    return this.http.post<{ fileId: string; downloadUrl: string; expiresAtUtc: string }>(
      `${this.base}/storage/files/${fileId}/download-url`,
      {},
    );
  }
}
