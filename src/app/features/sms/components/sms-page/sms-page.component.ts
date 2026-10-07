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
import { SmsStore, SMS_PAGE_SIZES } from '../../data-access/sms.store';
import { SmsCapabilities } from '../../data-access/sms-permissions';
import {
  SMS_BODY_MAX_LENGTH,
  SmsApiStatus,
  SmsContact,
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

  // Detail slide-over
  readonly detailOpen = signal(false);
  readonly detail = signal<SmsMessageDetail | null>(null);
  readonly detailLoading = signal(false);


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
      // Embebido: sin query params; el listado queda fijo al cliente del perfil.
      this.store.initList({ customerId: customer.id });
      return;
    }
    const q = this.route.snapshot.queryParamMap;
    const status = (q.get('status') as SmsStatusFilter) ?? 'All';
    const term = q.get('term') ?? '';
    const page = Number(q.get('page')) || 1;
    const size = Number(q.get('size')) || undefined;
    this.searchText.set(term);
    this.store.initList({ status, term, page, size });
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

  /** Llega ya debounceado por `app-search-input`. */
  onSearch(value: string): void {
    this.searchText.set(value);
    this.store.setTerm(value);
    this.syncUrl();
  }

  onPage(page: number): void {
    this.store.goToPage(page);
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
        status: this.store.status() === 'All' ? null : this.store.status(),
        term: this.store.term() || null,
        page: this.store.page() > 1 ? this.store.page() : null,
        size: this.store.size(),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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
    this.composeError.set(null);
    this.composeRecipients.set([]);
    this.composeBody.set('');
    this.composeOpen.set(true);
    const customer = this.embeddedCustomer();
    if (customer) this.preselectEmbedded(customer.id);
  }

  /** Embebido: el único destinatario es el cliente del perfil (se resuelve su teléfono vía directorio). */
  private preselectEmbedded(customerId: string): void {
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
    this.store
      .send(
        recipients.map(r => ({ customerId: r.id, to: r.phoneE164 as string, name: r.name })),
        body,
      )
      .subscribe({
        next: summary => {
          this.closeCompose();
          const parts = [`${summary.sent} sent`];
          if (summary.failed > 0) parts.push(`${summary.failed} failed`);
          if (summary.suppressed > 0) parts.push(`${summary.suppressed} opted out`);
          this.toastService.success(parts.join(' · '));
        },
        error: err => this.composeError.set(toApiError(err).message),
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
