import { CUSTOM_ELEMENTS_SCHEMA, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import { WalletStore } from '@features/wallet/data-access/wallet.store';
import { formatMicros } from '@features/wallet/data-access/wallet.model';
import { SmsStore, SMS_PAGE_SIZES } from '../../data-access/sms.store';
import { SmsCapabilities } from '../../data-access/sms-permissions';
import {
  SMS_BODY_MAX_LENGTH,
  SmsApiStatus,
  SmsContact,
  SmsConversationSummary,
  SmsMessageDetail,
  SmsMessageSummary,
  SmsOptOutSummary,
  SmsStatusFilter,
  toSmsContact,
  toE164OrNull,
} from '../../data-access/sms.model';

/** Chip de estado en lenguaje simple (sin jerga técnica). */
interface StatusChip {
  label: string;
  chip: string;
  dot: string;
}

/** Segmentación aproximada (GSM-7 vs Unicode) para el contador del compose. */
interface Segments {
  count: number;
  segments: number;
  encoding: 'GSM-7' | 'Unicode';
  perSegment: number;
}

const GSM_STATUS_FILTERS: FilterChipOption<SmsStatusFilter>[] = [
  { id: 'All', label: 'All' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'Accepted', label: 'Sent' },
  { id: 'Failed', label: 'Not delivered' },
  { id: 'Undeliverable', label: 'Invalid number' },
  { id: 'Suppressed', label: 'Opted out' },
];

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Página del módulo SMS (Sms.Api vía /sms). Historial server-paginado, stats, bajas (opt-outs) y
 * compose. Todo en lenguaje simple: nada de proveedor, ids técnicos ni códigos de error crudos. Los
 * colores salen de las clases de marca (branding dinámico del tenant).
 *
 * Modo embebido (`injectEmbeddedCustomer()`, ver `@core/customers/embedded-customer`): lo monta
 * `ClientSmsWorkspaceComponent` en el perfil del cliente. Fija el listado a ese cliente, no toca la
 * URL, oculta Opt-outs (es de todo el tenant) y el compose va directo a ese único cliente.
 */
@Component({
  selector: 'app-sms-page',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    PaginationComponent,
    AvatarComponent,
    CustomerPickerComponent,
    DrawerComponent,
    FilterChipsComponent,
    SearchInputComponent,
    SegmentedComponent,
    StateBlockComponent,
    StatusPillComponent,
  ],
  templateUrl: './sms-page.component.html',
})
export class SmsPageComponent implements OnInit {
  readonly store = inject(SmsStore);
  readonly caps = inject(SmsCapabilities);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastService = inject(ToastService);
  private readonly directory = inject(CustomerDirectoryStore);
  // Cobro visible (F6): el envío individual se cobra al monedero ($0.25/SMS). Comparte el WalletStore
  // singleton con el pill del header y el apartado Wallet — un envío o recarga refresca los tres.
  private readonly wallet = inject(WalletStore);

  private readonly embeddedCustomer = injectEmbeddedCustomer();
  readonly embedded = computed(() => this.embeddedCustomer() !== null);
  /** Subtítulo de la cabecera (embebido: el cliente). */
  readonly subtitle = computed(() => {
    const customer = this.embeddedCustomer();
    return customer ? `Text messages with ${customer.name}` : 'Text your clients and track delivery';
  });
  /** Contacto SMS del cliente embebido (resuelto vía el directorio al abrir el compose). */
  private readonly embeddedContact = signal<SmsContact | null>(null);
  readonly embeddedContactLoading = signal(false);

  readonly pageSizes = SMS_PAGE_SIZES;
  readonly statusFilters = GSM_STATUS_FILTERS;
  readonly bodyMaxLength = SMS_BODY_MAX_LENGTH;

  readonly searchDebounceMs = SEARCH_DEBOUNCE_MS;
  readonly tabs: SegmentedOption<'messages' | 'optouts'>[] = [
    { id: 'messages', label: 'Messages' },
    { id: 'optouts', label: 'Opt-outs' },
  ];

  readonly activeTab = signal<'messages' | 'optouts'>('messages');
  readonly searchText = signal('');
  readonly optSearchText = signal('');

  // Compose
  readonly composeOpen = signal(false);
  readonly composeRecipients = signal<SmsContact[]>([]);
  readonly composeBody = signal('');
  readonly composeError = signal<string | null>(null);

  // Cobro visible (F6): costo del envío (destinatarios × tarifa SMS) vs saldo + red de seguridad ante
  // el 402 `sms.insufficientFunds`. El costo es un TOPE: los opted-out los suprime y NO los cobra el
  // backend, así que el cargo real puede ser menor ("up to").
  readonly walletAvailableLabel = computed(() => formatMicros(this.wallet.availableMicros(), this.wallet.currency()));
  readonly smsRateMicros = computed(() => this.wallet.displayRates().find(r => r.channel === 'Sms')?.unitPriceMicros ?? 0);
  readonly estimatedCostMicros = computed(() => this.composeRecipients().length * this.smsRateMicros());
  readonly estimatedDeficitMicros = computed(() => Math.max(0, this.estimatedCostMicros() - this.wallet.availableMicros()));
  readonly estimatedSufficient = computed(() => this.estimatedDeficitMicros() === 0);
  readonly sendDeficitMessage = signal<string | null>(null);
  readonly fmtMicros = (micros: number): string => formatMicros(micros, this.wallet.currency());
  readonly rateLabel = (micros: number): string => formatMicros(micros, this.wallet.currency(), 4);

  // Detail slide-over
  readonly detailOpen = signal(false);
  readonly detail = signal<SmsMessageDetail | null>(null);
  readonly detailLoading = signal(false);

  // Thread drawer (conversación de un cliente) — solo en modo tenant-wide (no embebido).
  readonly threadOpen = signal(false);
  readonly threadConv = signal<SmsConversationSummary | null>(null);


  /** Destinatarios deliverables (excluye opted-out) para el contador del botón Send. */
  readonly deliverableRecipients = computed(() => this.composeRecipients());

  /**
   * Filtro del picker de destinatarios: solo clientes texteables (teléfono E.164 válido) y aún no
   * elegidos. Lee la señal de destinatarios, así los recientes del picker se recalculan solos.
   */
  readonly pickerFilter = (customer: CustomerSummary): boolean =>
    toE164OrNull(customer.primaryPhone) !== null && !this.composeRecipients().some(r => r.id === customer.id);

  /** Mensaje del bloque de error del listado (en lenguaje simple, según el tipo de fallo). */
  readonly listErrorText = computed<string | null>(() => {
    if (!this.store.listError()) return null;
    return this.store.listErrorKind() === 'network'
      ? 'Can’t reach the server right now.'
      : 'Something went wrong loading messages.';
  });

  /** Ídem para la vista de conversaciones (tenant-wide). */
  readonly convErrorText = computed<string | null>(() => {
    if (!this.store.convError()) return null;
    return this.store.convErrorKind() === 'network'
      ? 'Can’t reach the server right now.'
      : 'Something went wrong loading conversations.';
  });

  readonly segments = computed<Segments>(() => this.computeSegments(this.composeBody()));

  /**
   * Nombre a mostrar para una fila: 1) el snapshot del mensaje (recipientName, semántica correcta del
   * log); 2) el nombre resuelto por el directorio compartido (solo los ids del listado); 3) el teléfono.
   */
  clientName(recipientName: string | null, customerId: string, phone: string): string {
    return recipientName || this.store.contactsById().get(customerId) || phone;
  }

  ngOnInit(): void {
    const customer = this.embeddedCustomer();
    if (customer) {
      // Embebido (perfil del cliente): el listado plano queda fijo a ese cliente — ya ES su hilo.
      this.store.initList({ customerId: customer.id });
      return;
    }
    // Tenant-wide: la pestaña Messages muestra CONVERSACIONES (una fila por cliente); el hilo completo
    // se abre en un drawer. Solo se persisten en la URL el término y la página.
    const q = this.route.snapshot.queryParamMap;
    const term = q.get('term') ?? '';
    const page = Number(q.get('page')) || 1;
    this.searchText.set(term);
    this.store.initConversations({ term, page });
  }

  // ---------- Tabs ----------

  setTab(tab: 'messages' | 'optouts'): void {
    this.activeTab.set(tab);
    if (tab === 'optouts') this.store.initOptOuts();
  }

  // ---------- Messages filters ----------

  setStatus(status: SmsStatusFilter): void {
    this.store.setStatus(status);
    this.syncUrl();
  }

  /** Llega ya debounceado por `app-search-input`. Embebido filtra el historial del cliente; tenant-wide
   *  filtra las conversaciones (por nombre/teléfono/texto). */
  onSearch(value: string): void {
    this.searchText.set(value);
    if (this.embedded()) this.store.setTerm(value);
    else this.store.setConvTerm(value);
    this.syncUrl();
  }

  onPage(page: number): void {
    if (this.embedded()) this.store.goToPage(page);
    else this.store.goToConvPage(page);
    this.syncUrl();
  }

  onSize(size: number): void {
    this.store.setSize(size);
    this.syncUrl();
  }

  private syncUrl(): void {
    if (this.embedded()) return; // embebido: no se escribe en la URL del perfil
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        term: this.store.convTerm() || null,
        page: this.store.convPage() > 1 ? this.store.convPage() : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---------- Conversación (hilo) ----------

  /** Abre el hilo de un cliente desde la lista de conversaciones. */
  openThread(c: SmsConversationSummary): void {
    this.threadConv.set(c);
    this.threadOpen.set(true);
    this.store.openThread(c.customerId);
  }

  closeThread(): void {
    this.threadOpen.set(false);
    this.store.closeThread();
  }

  /** "Send SMS" desde el hilo abierto: abre el compose ya apuntando a ese cliente. */
  composeToThreadClient(): void {
    const c = this.threadConv();
    if (!c) return;
    this.openComposeForCustomer(c.customerId);
  }

  // ---------- Opt-outs ----------

  /** Llega ya debounceado por `app-search-input`. */
  onOptSearch(value: string): void {
    this.optSearchText.set(value);
    this.store.setOptTerm(value);
  }

  toggleConsent(row: SmsOptOutSummary): void {
    const action = row.status === 'OptedOut' ? 'OptIn' : 'OptOut';
    this.store.setConsent({ customerId: row.customerId, phone: row.phoneE164, action }).subscribe({
      next: () =>
        this.toastService.success(action === 'OptOut' ? 'Client opted out of texts.' : 'Client re-subscribed to texts.'),
      error: err => this.toastService.error(toApiError(err).message),
    });
  }

  // ---------- Compose ----------

  openCompose(): void {
    this.resetCompose();
    const customer = this.embeddedCustomer();
    if (customer) this.preselectCustomer(customer.id);
  }

  /** Abre el compose ya apuntando a un cliente (desde el hilo de conversación). */
  openComposeForCustomer(customerId: string): void {
    this.resetCompose();
    this.preselectCustomer(customerId);
  }

  private resetCompose(): void {
    this.composeError.set(null);
    this.sendDeficitMessage.set(null);
    this.composeRecipients.set([]);
    this.composeBody.set('');
    this.composeOpen.set(true);
    this.wallet.init(); // saldo + tarifas para el hint de costo (carga idempotente)
  }

  /** CTA "Top up and retry" del banner de saldo insuficiente: lleva al apartado Wallet. */
  goToWalletTopUp(): void {
    this.closeCompose();
    this.router.navigate(['/wallet']);
  }

  /** Preselecciona un cliente como único destinatario (se resuelve su teléfono vía el directorio). */
  private preselectCustomer(customerId: string): void {
    const cached = this.embeddedContact();
    if (cached?.id === customerId) {
      this.composeRecipients.set(cached.phoneE164 ? [cached] : []);
      return;
    }
    this.embeddedContactLoading.set(true);
    this.directory.byId([customerId]).subscribe({
      next: resolved => {
        const summary = resolved.get(customerId);
        const contact = summary ? toSmsContact(summary) : null;
        this.embeddedContact.set(contact);
        this.composeRecipients.set(contact?.phoneE164 ? [contact] : []);
        this.embeddedContactLoading.set(false);
        if (!contact?.phoneE164) this.composeError.set('This client doesn’t have a valid mobile number.');
      },
      error: () => {
        this.embeddedContactLoading.set(false);
        this.composeError.set('Couldn’t load this client’s phone number.');
      },
    });
  }

  closeCompose(): void {
    this.composeOpen.set(false);
  }

  /** Elección del picker (variant inline: emite y se limpia). */
  onPickCustomer(customer: CustomerSummary | null): void {
    if (customer) this.addRecipient(toSmsContact(customer));
  }

  addRecipient(contact: SmsContact): void {
    if (!contact.phoneE164 || this.composeRecipients().some(r => r.id === contact.id)) return;
    this.composeRecipients.update(list => [...list, contact]);
  }

  removeRecipient(id: string): void {
    this.composeRecipients.update(list => list.filter(c => c.id !== id));
  }

  send(): void {
    const body = this.composeBody().trim();
    const recipients = this.composeRecipients();
    if (!body || recipients.length === 0 || this.store.sending()) return;
    this.composeError.set(null);
    this.sendDeficitMessage.set(null);
    this.store
      .send(
        recipients.map(r => ({ customerId: r.id, to: r.phoneE164 as string, name: r.name })),
        body,
      )
      .subscribe({
        next: summary => {
          this.closeCompose();
          this.wallet.refresh(); // el cobro ya se liquidó → refresca el saldo visible de inmediato
          this.store.reloadConversations(); // refresca la vista agrupada tras enviar
          const parts = [`${summary.sent} sent`];
          if (summary.failed > 0) parts.push(`${summary.failed} failed`);
          if (summary.suppressed > 0) parts.push(`${summary.suppressed} opted out`);
          this.toastService.success(parts.join(' · '));
        },
        error: err => {
          const e = toApiError(err);
          // Cobro F6: saldo insuficiente (402) → banner con faltante + "Top up and retry" (modal abierto).
          if (e.code === 'sms.insufficientFunds') {
            this.sendDeficitMessage.set(
              'Not enough wallet balance to send these messages. Top up and try again.',
            );
            this.wallet.refresh();
          } else {
            this.composeError.set(e.message);
          }
        },
      });
  }

  // ---------- Detail ----------

  openDetail(row: SmsMessageSummary): void {
    this.detail.set(null);
    this.detailLoading.set(true);
    this.detailOpen.set(true);
    this.store.getMessage(row.id).subscribe({
      next: d => {
        this.detail.set(d);
        this.detailLoading.set(false);
      },
      error: () => this.detailLoading.set(false),
    });
  }

  closeDetail(): void {
    this.detailOpen.set(false);
  }

  // ---------- Presentación ----------

  /** Colores exactos de los chips de sms sobre `app-status-pill` (sin borde visible, en negrita). */
  pill(colorClass: string): string {
    return `${colorClass} border-transparent font-bold`;
  }

  /** Estado → chip en lenguaje simple + clases de color (semánticas, no la marca). */
  statusChip(status: SmsApiStatus): StatusChip {
    switch (status) {
      case 'Delivered':
        return { label: 'Delivered', chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
      case 'Accepted':
        return { label: 'Sent', chip: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' };
      case 'Pending':
        return { label: 'Sending…', chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
      case 'Suppressed':
        return { label: 'Opted out', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
      case 'Undeliverable':
        return { label: 'Invalid number', chip: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' };
      case 'Failed':
        return { label: 'Not delivered', chip: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' };
    }
  }

  /** Motivo del fallo/estado en lenguaje simple para el detalle (sin códigos técnicos). */
  reasonText(status: SmsApiStatus): string {
    switch (status) {
      case 'Undeliverable':
        return 'Invalid number — check the client’s phone number.';
      case 'Suppressed':
        return 'Client opted out of texts (replied STOP).';
      case 'Failed':
        return 'Couldn’t be delivered — try again later.';
      case 'Delivered':
        return 'Delivered to the client’s phone.';
      case 'Accepted':
        return 'Sent to the carrier — delivery pending.';
      case 'Pending':
        return 'Sending…';
    }
  }

  private computeSegments(body: string): Segments {
    const count = body.length;
    const isUnicode = /[^\x00-\x7f]/.test(body); // aprox: cualquier char fuera de ASCII → Unicode
    const single = isUnicode ? 70 : 160;
    const multi = isUnicode ? 67 : 153;
    const segments = count === 0 ? 1 : count <= single ? 1 : Math.ceil(count / multi);
    return { count, segments, encoding: isUnicode ? 'Unicode' : 'GSM-7', perSegment: segments === 1 ? single : multi };
  }
}
