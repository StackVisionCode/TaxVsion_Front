import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
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
  avatarColorFor,
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

const GSM_STATUS_FILTERS: { value: SmsStatusFilter; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Accepted', label: 'Sent' },
  { value: 'Failed', label: 'Not delivered' },
  { value: 'Undeliverable', label: 'Invalid number' },
  { value: 'Suppressed', label: 'Opted out' },
];

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Página del módulo SMS (Sms.Api vía /sms). Historial server-paginado, stats, bajas (opt-outs) y
 * compose. Todo en lenguaje simple: nada de proveedor, ids técnicos ni códigos de error crudos. Los
 * colores salen de las clases de marca (branding dinámico del tenant).
 */
@Component({
  selector: 'app-sms-page',
  imports: [CommonModule, FormsModule, ModalComponent, PaginationComponent],
  templateUrl: './sms-page.component.html',
})
export class SmsPageComponent implements OnInit {
  readonly store = inject(SmsStore);
  readonly caps = inject(SmsCapabilities);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly pageSizes = SMS_PAGE_SIZES;
  readonly statusFilters = GSM_STATUS_FILTERS;
  readonly bodyMaxLength = SMS_BODY_MAX_LENGTH;

  readonly activeTab = signal<'messages' | 'optouts'>('messages');
  readonly searchText = signal('');
  readonly optSearchText = signal('');

  // Compose
  readonly composeOpen = signal(false);
  readonly composeRecipients = signal<SmsContact[]>([]);
  readonly composeBody = signal('');
  readonly composeError = signal<string | null>(null);
  readonly pickerQuery = signal('');
  readonly pickerOpen = signal(false);

  // Detail slide-over
  readonly detailOpen = signal(false);
  readonly detail = signal<SmsMessageDetail | null>(null);
  readonly detailLoading = signal(false);

  readonly toast = signal<string | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private optSearchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Destinatarios deliverables (excluye opted-out) para el contador del botón Send. */
  readonly deliverableRecipients = computed(() => this.composeRecipients());

  /** Candidatos del picker: resultados de la búsqueda server-side, menos los ya elegidos. */
  readonly pickerResults = computed<SmsContact[]>(() => {
    const chosen = new Set(this.composeRecipients().map(r => r.id));
    return this.store.pickerResults().filter(c => !chosen.has(c.id));
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

  onSearch(value: string): void {
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.store.setTerm(value);
      this.syncUrl();
    }, SEARCH_DEBOUNCE_MS);
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

  onOptSearch(value: string): void {
    this.optSearchText.set(value);
    if (this.optSearchTimer) clearTimeout(this.optSearchTimer);
    this.optSearchTimer = setTimeout(() => this.store.setOptTerm(value), SEARCH_DEBOUNCE_MS);
  }

  toggleConsent(row: SmsOptOutSummary): void {
    const action = row.status === 'OptedOut' ? 'OptIn' : 'OptOut';
    this.store.setConsent({ customerId: row.customerId, phone: row.phoneE164, action }).subscribe({
      next: () =>
        this.showToast(action === 'OptOut' ? 'Client opted out of texts.' : 'Client re-subscribed to texts.'),
      error: err => this.showToast(toApiError(err).message),
    });
  }

  // ---------- Compose ----------

  openCompose(): void {
    this.composeError.set(null);
    this.composeRecipients.set([]);
    this.composeBody.set('');
    this.pickerQuery.set('');
    this.composeOpen.set(true);
    this.store.searchPicker(''); // resultados iniciales (primeros clientes texteables)
  }

  onPickerInput(value: string): void {
    this.pickerQuery.set(value);
    this.pickerOpen.set(true);
    this.store.searchPicker(value);
  }

  closeCompose(): void {
    this.composeOpen.set(false);
    this.pickerOpen.set(false);
  }

  addRecipient(contact: SmsContact): void {
    this.composeRecipients.update(list => [...list, contact]);
    this.pickerQuery.set('');
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
          this.showToast(parts.join(' · '));
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

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }

  avatarColor(id: string): string {
    return avatarColorFor(id);
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
    const isUnicode = /[^ -]/.test(body); // aprox: cualquier char fuera de ASCII → Unicode
    const single = isUnicode ? 70 : 160;
    const multi = isUnicode ? 67 : 153;
    const segments = count === 0 ? 1 : count <= single ? 1 : Math.ceil(count / multi);
    return { count, segments, encoding: isUnicode ? 'Unicode' : 'GSM-7', perSegment: segments === 1 ? single : multi };
  }

  private showToast(message: string): void {
    this.toast.set(message);
    setTimeout(() => {
      if (this.toast() === message) this.toast.set(null);
    }, 3500);
  }
}
