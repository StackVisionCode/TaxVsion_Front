import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap, catchError, map } from 'rxjs';
import { toUserMessage } from '@core/errors/error-messages';
import { ToastService } from '@shared/ui/toast/toast.service';
import { parseUtcDateOrNull, utcTime } from '@shared/utils/utc-date.util';
import { BillingService } from './billing.service';
import {
  BillingCatalogItem,
  BillingCustomerSummary,
  EMPTY_ISSUER_PROFILE,
  InvoiceBranding,
  InvoiceLineDraft,
  InvoiceStatus,
  InvoiceSummary,
  IssuerProfile,
  PaymentConfig,
  PaymentLink,
  PaymentLinkStatus,
  PaymentPurposeKind,
  toCents,
} from './billing.model';

/** Tamaños de carga que ofrece la UI. Mapean a `?take=` — el endpoint no pagina de verdad. */
export const TAKE_OPTIONS = [25, 50, 100, 200];

/** Filas por página del recorte client-side sobre lo ya cargado. */
const PAGE_SIZE = 10;

/** Links de pago por página (acá la paginación SÍ es del backend). */
const LINKS_PAGE_SIZE = 20;

/** Sondeo del link de cobro y del PDF tras emitir: ambos llegan por eventos, no en la respuesta. */
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1500;

/** Filtro de estado del listado; `All` no filtra. */
export type InvoiceStatusFilter = InvoiceStatus | 'All';

/** Agregados del listado, todos derivables de `InvoiceSummary` sin inventar nada. */
export interface InvoiceMetrics {
  outstandingCents: number;
  collectedCents: number;
  draftCount: number;
  /** Media de días entre creación y cobro sobre las pagadas; null si todavía no hay ninguna. */
  averageDaysToPay: number | null;
  currency: string;
}

/**
 * Estado de la sección de facturación. Vive en la ruta (`providers` de `billing.routes.ts`), así
 * que muere al salir de `/billing`.
 *
 * Dos límites del backend condicionan el diseño y conviene tenerlos presentes al leer esto:
 *
 * 1. `GET /billing/invoices` **solo acepta `take`**: no pagina, no filtra y no ordena. Por eso
 *    todos los filtros (estado, número, rango de fechas) y la paginación son client-side sobre lo
 *    que se trajo, y la UI deja claro cuántas facturas se cargaron.
 * 2. Emitir una factura NO devuelve ni el PDF ni el link de cobro: `issue` publica
 *    `EnsureInvoicePaymentLink` → `GenerateInvoicePdf` y Documents responde 202, así que
 *    `pdfFileId` y `checkoutUrl` aparecen segundos después. De ahí el sondeo de {@link issue}.
 */
@Injectable()
export class BillingStore {
  private readonly service = inject(BillingService);
  private readonly toast = inject(ToastService);

  // ---------- Facturas ----------

  private readonly _invoices = signal<InvoiceSummary[]>([]);
  private readonly _invoicesLoading = signal(false);
  private readonly _invoicesError = signal<string | null>(null);
  private readonly _take = signal(TAKE_OPTIONS[1]);

  readonly invoices = this._invoices.asReadonly();
  readonly invoicesLoading = this._invoicesLoading.asReadonly();
  readonly invoicesError = this._invoicesError.asReadonly();
  readonly take = this._take.asReadonly();

  /** Id de la factura con una operación en curso (emitir, cobrar, abrir PDF). */
  private readonly _busyInvoiceId = signal<string | null>(null);
  readonly busyInvoiceId = this._busyInvoiceId.asReadonly();

  // ---------- Filtros del listado (client-side, ver nota de clase) ----------

  private readonly _statusFilter = signal<InvoiceStatusFilter>('All');
  private readonly _numberQuery = signal('');
  private readonly _fromDate = signal('');
  private readonly _toDate = signal('');
  private readonly _page = signal(1);

  readonly statusFilter = this._statusFilter.asReadonly();
  readonly numberQuery = this._numberQuery.asReadonly();
  readonly fromDate = this._fromDate.asReadonly();
  readonly toDate = this._toDate.asReadonly();
  readonly page = this._page.asReadonly();
  readonly pageSize = PAGE_SIZE;

  readonly hasActiveFilters = computed(
    () =>
      this._statusFilter() !== 'All' ||
      this._numberQuery().trim().length > 0 ||
      !!this._fromDate() ||
      !!this._toDate(),
  );

  /** Conteo por estado para los badges de las pestañas (sobre TODO lo cargado, no lo filtrado). */
  readonly statusCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { All: this._invoices().length };
    for (const invoice of this._invoices()) {
      counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    }
    return counts;
  });

  readonly filteredInvoices = computed(() => {
    const status = this._statusFilter();
    const query = this._numberQuery().trim().toLowerCase();
    // El input date da 'YYYY-MM-DD' en hora local: el rango se compara con el día completo.
    const from = this._fromDate() ? new Date(`${this._fromDate()}T00:00:00`).getTime() : null;
    const to = this._toDate() ? new Date(`${this._toDate()}T23:59:59.999`).getTime() : null;

    return this._invoices().filter(invoice => {
      if (status !== 'All' && invoice.status !== status) {
        return false;
      }
      if (query && !(invoice.invoiceNumber ?? '').toLowerCase().includes(query)) {
        return false;
      }
      if (from !== null || to !== null) {
        const created = utcTime(invoice.createdAtUtc);
        if (created === null) {
          return false;
        }
        if (from !== null && created < from) {
          return false;
        }
        if (to !== null && created > to) {
          return false;
        }
      }
      return true;
    });
  });

  /** Página visible del listado filtrado. */
  readonly pagedInvoices = computed(() => {
    const start = (this._page() - 1) * PAGE_SIZE;
    return this.filteredInvoices().slice(start, start + PAGE_SIZE);
  });

  readonly metrics = computed<InvoiceMetrics>(() => {
    const invoices = this._invoices();
    // Un borrador todavía no debe nada: no se emitió. `Voided` tampoco cuenta.
    const billable = invoices.filter(inv => inv.status !== 'Draft' && inv.status !== 'Voided');

    let totalDays = 0;
    let paidCount = 0;
    for (const invoice of invoices) {
      const paidAt = parseUtcDateOrNull(invoice.paidAtUtc);
      const createdAt = parseUtcDateOrNull(invoice.createdAtUtc);
      if (paidAt && createdAt) {
        totalDays += (paidAt.getTime() - createdAt.getTime()) / 86_400_000;
        paidCount++;
      }
    }

    return {
      outstandingCents: billable.reduce((sum, inv) => sum + inv.amountDueCents, 0),
      collectedCents: invoices.reduce((sum, inv) => sum + inv.amountPaidCents, 0),
      draftCount: invoices.filter(inv => inv.status === 'Draft').length,
      averageDaysToPay: paidCount === 0 ? null : Math.round((totalDays / paidCount) * 10) / 10,
      // Billing no expone una moneda de cuenta: se toma la de la primera factura.
      currency: invoices[0]?.currency ?? 'USD',
    };
  });

  setStatusFilter(status: InvoiceStatusFilter): void {
    this._statusFilter.set(status);
    this._page.set(1);
  }

  setNumberQuery(query: string): void {
    this._numberQuery.set(query);
    this._page.set(1);
  }

  setFromDate(value: string): void {
    this._fromDate.set(value);
    this._page.set(1);
  }

  setToDate(value: string): void {
    this._toDate.set(value);
    this._page.set(1);
  }

  clearFilters(): void {
    this._statusFilter.set('All');
    this._numberQuery.set('');
    this._fromDate.set('');
    this._toDate.set('');
    this._page.set(1);
  }

  setPage(page: number): void {
    this._page.set(page);
  }

  /** Cambiar el tamaño recarga: `take` es del servidor, no un recorte local. */
  setTake(take: number): void {
    if (take === this._take()) {
      return;
    }
    this._take.set(take);
    this.loadInvoices(true);
  }

  // ---------- Carga y acciones sobre facturas ----------

  private invoicesLoaded = false;

  loadInvoices(force = false): void {
    if (this._invoicesLoading() || (this.invoicesLoaded && !force)) {
      return;
    }
    this._invoicesLoading.set(true);
    this._invoicesError.set(null);
    this.service.listInvoices(this._take()).subscribe({
      next: invoices => {
        this._invoices.set(invoices ?? []);
        this.invoicesLoaded = true;
        this._invoicesLoading.set(false);
        this._page.set(1);
      },
      error: err => {
        this._invoicesError.set(toUserMessage(err));
        this._invoicesLoading.set(false);
      },
    });
  }

  /**
   * Emite el borrador y sondea hasta que aparezcan `checkoutUrl` y `pdfFileId`, que Billing
   * resuelve por eventos después de responder. Si se agotan los intentos NO se finge un fallo:
   * la factura ya está emitida, solo faltan los artefactos.
   */
  issue(invoiceId: string): void {
    this._busyInvoiceId.set(invoiceId);
    this.service.issueInvoice(invoiceId).subscribe({
      next: result => {
        this.toast.success(`Invoice ${result.invoiceNumber} issued.`);
        this.pollInvoice(invoiceId, 0);
      },
      error: err => {
        this._busyInvoiceId.set(null);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  private pollInvoice(invoiceId: string, attempt: number): void {
    this.service.getInvoice(invoiceId).subscribe({
      next: updated => {
        this.patchInvoice(updated);
        const ready = !!updated.checkoutUrl && !!updated.pdfFileId;
        if (ready) {
          this._busyInvoiceId.set(null);
          return;
        }
        if (attempt >= POLL_ATTEMPTS) {
          this._busyInvoiceId.set(null);
          this.toast.info('The payment link and PDF are still being generated. Refresh in a moment.');
          return;
        }
        setTimeout(() => this.pollInvoice(invoiceId, attempt + 1), POLL_INTERVAL_MS);
      },
      error: () => this._busyInvoiceId.set(null),
    });
  }

  /** Relee una factura suelta (para el botón de refrescar del detalle). */
  refreshInvoice(invoiceId: string): void {
    this.service.getInvoice(invoiceId).subscribe({
      next: updated => this.patchInvoice(updated),
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  private patchInvoice(updated: InvoiceSummary): void {
    this._invoices.update(list => list.map(invoice => (invoice.id === updated.id ? updated : invoice)));
    if (this._selectedInvoice()?.id === updated.id) {
      this._selectedInvoice.set(updated);
    }
  }

  /** Registra un cobro offline. `amountCents` null = el saldo completo. */
  recordPayment(invoiceId: string, method: string, amountCents: number | null, onDone: () => void): void {
    this._busyInvoiceId.set(invoiceId);
    this.service.recordPayment(invoiceId, method, amountCents).subscribe({
      next: () => {
        this._busyInvoiceId.set(null);
        this.toast.success('Payment recorded.');
        onDone();
        // El pago dispara la regeneración del PDF con el recibo: hay que releer la fila.
        this.refreshInvoice(invoiceId);
      },
      error: err => {
        this._busyInvoiceId.set(null);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  /** Abre el PDF en otra pestaña vía URL presignada de CloudStorage. */
  openPdf(invoice: InvoiceSummary): void {
    if (!invoice.pdfFileId) {
      this.toast.info('The PDF is still being generated. Refresh in a moment.');
      return;
    }
    this._busyInvoiceId.set(invoice.id);
    this.service.getDownloadUrl(invoice.pdfFileId).subscribe({
      next: result => {
        this._busyInvoiceId.set(null);
        window.open(result.downloadUrl, '_blank', 'noopener');
      },
      error: err => {
        this._busyInvoiceId.set(null);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  // ---------- Detalle ----------

  private readonly _selectedInvoice = signal<InvoiceSummary | null>(null);
  readonly selectedInvoice = this._selectedInvoice.asReadonly();

  selectInvoice(invoice: InvoiceSummary | null): void {
    this._selectedInvoice.set(invoice);
  }

  // ---------- Crear factura ----------

  private readonly _creating = signal(false);
  readonly creating = this._creating.asReadonly();

  /**
   * Crea el borrador y, si `alsoIssue`, lo emite en el acto (los dos botones del formulario:
   * "Save as draft" y "Save and issue"). No hay endpoint de update, así que esto es un camino de
   * una sola dirección: una vez creada, la factura ya no se puede editar.
   */
  createInvoice(
    customer: BillingCustomerSummary,
    customerTaxId: string,
    currency: string,
    lines: InvoiceLineDraft[],
    notes: string,
    alsoIssue: boolean,
    onDone: () => void,
  ): void {
    this._creating.set(true);
    this.service.createInvoice(customer, customerTaxId, currency, lines, notes).subscribe({
      next: result => {
        this._creating.set(false);
        onDone();
        // Se recarga el listado en ambos casos; el sondeo de `issue` parchea después esa misma fila.
        this.loadInvoices(true);
        if (alsoIssue) {
          this.issue(result.invoiceId);
        } else {
          this.toast.success('Draft invoice created.');
        }
      },
      error: err => {
        this._creating.set(false);
        this.toast.error(toUserMessage(err));
      },
    });
  }

  // ---------- Búsqueda de clientes (typeahead server-side) ----------

  private readonly _customerResults = signal<BillingCustomerSummary[]>([]);
  private readonly _customerSearching = signal(false);
  private readonly _customerSearch$ = new Subject<string>();

  readonly customerResults = this._customerResults.asReadonly();
  readonly customerSearching = this._customerSearching.asReadonly();

  searchCustomers(term: string): void {
    this._customerSearch$.next(term.trim());
  }

  // ---------- Búsqueda en el catálogo ----------

  private readonly _catalogResults = signal<BillingCatalogItem[]>([]);
  private readonly _catalogSearching = signal(false);
  private readonly _catalogSearch$ = new Subject<string>();

  readonly catalogResults = this._catalogResults.asReadonly();
  readonly catalogSearching = this._catalogSearching.asReadonly();

  searchCatalog(term: string): void {
    this._catalogSearch$.next(term.trim());
  }

  // ---------- Proveedor de cobro ----------

  private readonly _paymentConfigs = signal<PaymentConfig[]>([]);
  private readonly _configsLoading = signal(false);
  private readonly _savingProvider = signal(false);

  readonly paymentConfigs = this._paymentConfigs.asReadonly();
  readonly configsLoading = this._configsLoading.asReadonly();
  readonly savingProvider = this._savingProvider.asReadonly();

  /** Hay cobro online disponible: condiciona el link de pago de las facturas. */
  readonly hasActiveProvider = computed(() => this._paymentConfigs().some(config => config.isActive));

  loadPaymentConfigs(): void {
    this._configsLoading.set(true);
    this.service.listPaymentConfigs().subscribe({
      next: configs => {
        this._paymentConfigs.set(configs ?? []);
        this._configsLoading.set(false);
      },
      error: () => {
        // Un tenant sin proveedor configurado es normal: no es un error que mostrar.
        this._paymentConfigs.set([]);
        this._configsLoading.set(false);
      },
    });
  }

  /**
   * Alta de Stripe en tres pasos encadenados, que es como lo exige PaymentClient: crear la config
   * (clave pública), guardar los secretos y recién ahí activar.
   */
  saveStripe(
    input: { publishableKey: string; secretKey: string; webhookSecret: string; statementDescriptor: string },
    onDone: () => void,
  ): void {
    this._savingProvider.set(true);
    this.service
      .createPaymentConfig({
        providerCode: 'Stripe',
        mode: 'DirectApiKeys',
        publishableKey: input.publishableKey.trim(),
        statementDescriptor: input.statementDescriptor.trim() || 'TAXVISION',
      })
      .pipe(
        switchMap(() =>
          this.service.setPaymentSecrets('Stripe', {
            secretKey: input.secretKey.trim(),
            webhookSecret: input.webhookSecret.trim() || 'whsec_placeholder',
          }),
        ),
        switchMap(() => this.service.activateProvider('Stripe')),
      )
      .subscribe({
        next: () => {
          this._savingProvider.set(false);
          this.toast.success('Stripe connected and activated.');
          onDone();
          this.loadPaymentConfigs();
        },
        error: err => {
          this._savingProvider.set(false);
          this.toast.error(toUserMessage(err));
        },
      });
  }

  toggleProvider(config: PaymentConfig): void {
    const operation = config.isActive
      ? this.service.deactivateProvider(config.providerCode, 'Deactivated from billing settings')
      : this.service.activateProvider(config.providerCode);
    operation.subscribe({
      next: () => {
        this.toast.success(config.isActive ? 'Provider deactivated.' : 'Provider activated.');
        this.loadPaymentConfigs();
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  // ---------- Empresa: emisor + marca del PDF ----------

  private readonly _issuer = signal<IssuerProfile>({ ...EMPTY_ISSUER_PROFILE });
  private readonly _branding = signal<InvoiceBranding>({
    displayName: null,
    logoDataUri: null,
    brandColorHex: null,
    footerText: null,
  });
  private readonly _savingCompany = signal(false);

  readonly issuer = this._issuer.asReadonly();
  readonly branding = this._branding.asReadonly();
  readonly savingCompany = this._savingCompany.asReadonly();

  /** Sin emisor guardado, el PDF sale sin los datos de la firma: lo avisa la pestaña Invoices. */
  readonly hasIssuerProfile = computed(() => this._issuer().name.trim().length > 0);

  loadCompany(): void {
    this.service.getIssuerProfile().subscribe({
      next: profile =>
        this._issuer.set({
          name: profile.name || '',
          taxId: profile.taxId || '',
          line1: profile.line1 || '',
          city: profile.city || '',
          state: profile.state || '',
          zip: profile.zip || '',
          country: profile.country || 'US',
          phone: profile.phone || '',
          email: profile.email || '',
          website: profile.website || '',
        }),
      // El backend sintetiza un perfil vacío cuando no hay fila: un error acá no es "no existe".
      error: () => this._issuer.set({ ...EMPTY_ISSUER_PROFILE }),
    });
    this.service.getBranding().subscribe({
      next: branding =>
        this._branding.set({
          displayName: branding.displayName ?? null,
          logoDataUri: branding.logoDataUri ?? null,
          brandColorHex: branding.brandColorHex ?? null,
          footerText: branding.footerText ?? null,
        }),
      error: () => undefined,
    });
  }

  saveCompany(issuer: IssuerProfile, branding: InvoiceBranding): void {
    if (!issuer.name.trim()) {
      this.toast.error('The company name is required.');
      return;
    }
    this._savingCompany.set(true);
    this.service
      .saveIssuerProfile(issuer)
      .pipe(switchMap(() => this.service.saveBranding(branding)))
      .subscribe({
        next: () => {
          this._savingCompany.set(false);
          this._issuer.set({ ...issuer });
          this._branding.set({ ...branding });
          this.toast.success('Company details saved. They will appear on the next invoices.');
        },
        error: err => {
          this._savingCompany.set(false);
          this.toast.error(toUserMessage(err));
        },
      });
  }

  // ---------- Links de pago ----------

  private readonly _paymentLinks = signal<PaymentLink[]>([]);
  private readonly _linksLoading = signal(false);
  private readonly _linksError = signal<string | null>(null);
  private readonly _linkStatusFilter = signal<PaymentLinkStatus | null>(null);
  private readonly _linkPage = signal(1);
  private readonly _creatingLink = signal(false);

  readonly paymentLinks = this._paymentLinks.asReadonly();
  readonly linksLoading = this._linksLoading.asReadonly();
  readonly linksError = this._linksError.asReadonly();
  readonly linkStatusFilter = this._linkStatusFilter.asReadonly();
  readonly linkPage = this._linkPage.asReadonly();
  readonly creatingLink = this._creatingLink.asReadonly();
  readonly linksPageSize = LINKS_PAGE_SIZE;

  /** El endpoint devuelve un array plano: una página llena sugiere que hay más. */
  readonly linksHasMore = computed(() => this._paymentLinks().length === LINKS_PAGE_SIZE);

  setLinkStatusFilter(status: PaymentLinkStatus | null): void {
    this._linkStatusFilter.set(status);
    this._linkPage.set(1);
    this.loadPaymentLinks();
  }

  setLinkPage(page: number): void {
    this._linkPage.set(Math.max(1, page));
    this.loadPaymentLinks();
  }

  loadPaymentLinks(): void {
    this._linksLoading.set(true);
    this._linksError.set(null);
    this.service.listPaymentLinks(this._linkStatusFilter(), this._linkPage(), LINKS_PAGE_SIZE).subscribe({
      next: links => {
        this._paymentLinks.set(links ?? []);
        this._linksLoading.set(false);
      },
      error: err => {
        this._linksError.set(toUserMessage(err));
        this._linksLoading.set(false);
      },
    });
  }

  createPaymentLink(
    input: { amount: number; currency: string; purposeKind: PaymentPurposeKind; reference: string; expiration: string },
    onDone: (token: string) => void,
  ): void {
    this._creatingLink.set(true);
    this.service
      .createPaymentLink({
        amountCents: toCents(input.amount),
        currency: input.currency,
        purposeKind: input.purposeKind,
        purposeExternalReferenceId: input.reference.trim() || null,
        expiration: input.expiration,
      })
      .subscribe({
        next: result => {
          this._creatingLink.set(false);
          this.toast.success('Payment link created.');
          onDone(result.token);
          this.loadPaymentLinks();
        },
        error: err => {
          this._creatingLink.set(false);
          this.toast.error(toUserMessage(err));
        },
      });
  }

  revokePaymentLink(link: PaymentLink, reason: string): void {
    this.service.revokePaymentLink(link.id, reason).subscribe({
      next: () => {
        this.toast.success('Payment link revoked.');
        this.loadPaymentLinks();
      },
      error: err => this.toast.error(toUserMessage(err)),
    });
  }

  // ---------- Portapapeles ----------

  /** Copiar al portapapeles con acuse; `writeText` puede fallar si el documento no tiene foco. */
  copyToClipboard(value: string, successMessage: string): void {
    navigator.clipboard?.writeText(value).then(
      () => this.toast.success(successMessage),
      () => this.toast.error("We couldn't copy that. Copy it manually."),
    );
  }

  // ---------- Arranque ----------

  private initialized = false;

  /** Idempotente: la página lo llama en `ngOnInit` y las pestañas no recargan al alternar. */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.wireCustomerSearch();
    this.wireCatalogSearch();
    this.loadInvoices();
    this.loadPaymentConfigs();
    this.loadCompany();
  }

  private wireCustomerSearch(): void {
    this._customerSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term => {
          this._customerSearching.set(true);
          return this.service.searchCustomers(term).pipe(catchError(() => of<BillingCustomerSummary[]>([])));
        }),
      )
      .subscribe(items => {
        this._customerResults.set(items);
        this._customerSearching.set(false);
      });
  }

  private wireCatalogSearch(): void {
    this._catalogSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term => {
          this._catalogSearching.set(true);
          return this.service.searchCatalogItems(term).pipe(
            // Un tenant sin catálogo (o sin permiso) no debe romper el formulario de factura.
            map(items => items.filter(item => item.isActive)),
            catchError(() => of<BillingCatalogItem[]>([])),
          );
        }),
      )
      .subscribe(items => {
        this._catalogResults.set(items);
        this._catalogSearching.set(false);
      });
  }
}
