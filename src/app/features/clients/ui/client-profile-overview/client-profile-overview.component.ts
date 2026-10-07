import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';
import { CustomerAssignee, CustomerLanguage, PreferredChannel } from '../../data-access/clients.model';
import { ApiTaskPriority, ApiTaskStatus } from '../../data-access/client-work.model';
import { ClientOverviewStore, OverviewSection } from '../../data-access/client-overview.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import { ClientsStore } from '../../data-access/clients.store';
import { StaffDirectoryStore } from '../../data-access/staff-directory.store';
import { ClientAssignDialogComponent } from '../client-assign-dialog/client-assign-dialog.component';
import { CountUpDirective } from '@shared/directives/count-up.directive';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { formatPhoneForDisplay } from '@shared/utils/phone.util';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { formatMoney } from '@shared/utils/format.util';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { ClientProfileTabId } from '../../data-access/client-tab-access';
import {
  SummaryInvoiceStatus,
  SummaryMeeting,
  SummarySignatureStatus,
  SummarySmsStatus,
} from '../../data-access/client-summary.service';
import { portalStatusChipClass, portalStatusLabel } from '../../data-access/client-portal.model';

/** Pestañas del perfil a las que el Overview puede saltar desde sus "See all". */
export type OverviewTabLink = Exclude<ClientProfileTabId, 'overview'>;

const INVOICE_CHIPS: Record<SummaryInvoiceStatus, string> = {
  Draft: 'bg-gray-100 text-gray-500',
  Issued: 'bg-indigo-50 text-indigo-600',
  Sent: 'bg-indigo-50 text-indigo-600',
  PartiallyPaid: 'bg-amber-50 text-amber-600',
  Paid: 'bg-emerald-50 text-emerald-600',
  Voided: 'bg-gray-100 text-gray-400',
};

const INVOICE_LABELS: Record<SummaryInvoiceStatus, string> = {
  Draft: 'Draft',
  Issued: 'Issued',
  Sent: 'Sent',
  PartiallyPaid: 'Partial',
  Paid: 'Paid',
  Voided: 'Voided',
};

const SIGNATURE_CHIPS: Record<SummarySignatureStatus, string> = {
  Draft: 'bg-gray-100 text-gray-500',
  Ready: 'bg-indigo-50 text-indigo-600',
  Scheduled: 'bg-indigo-50 text-indigo-600',
  InProgress: 'bg-amber-50 text-amber-600',
  Completed: 'bg-emerald-50 text-emerald-600',
  Rejected: 'bg-red-50 text-red-600',
  Canceled: 'bg-gray-100 text-gray-400',
  Expired: 'bg-red-50 text-red-500',
};

const SIGNATURE_LABELS: Record<SummarySignatureStatus, string> = {
  Draft: 'Draft',
  Ready: 'Ready',
  Scheduled: 'Scheduled',
  InProgress: 'Awaiting',
  Completed: 'Signed',
  Rejected: 'Rejected',
  Canceled: 'Canceled',
  Expired: 'Expired',
};

const SMS_CHIPS: Record<SummarySmsStatus, string> = {
  Pending: 'text-gray-400',
  Accepted: 'text-indigo-500',
  Delivered: 'text-emerald-500',
  Failed: 'text-red-500',
  Undeliverable: 'text-red-500',
  Suppressed: 'text-gray-400',
};

/** Reloj del Overview: refresca cuentas regresivas ("in 2h") sin recargar datos. */
const CLOCK_TICK_MS = 30_000;

/** Fondos de las tarjetas de Activity, rotando como en una agenda (mismos tonos de marca/Tailwind). */
const ACTIVITY_TINTS = [
  'from-orange-50 to-amber-50/40 border-orange-100',
  'from-indigo-50 to-sky-50/40 border-indigo-100',
  'from-violet-50 to-indigo-50/40 border-violet-100',
];

const LANGUAGE_LABELS: Record<CustomerLanguage, string> = {
  En: 'English',
  Es: 'Spanish',
  Pt: 'Portuguese',
  Fr: 'French',
};

const CHANNEL_LABELS: Record<PreferredChannel, string> = {
  Email: 'Email',
  Sms: 'SMS',
  Call: 'Phone call',
};

const FILING_LABELS: Record<string, string> = {
  Single: 'Single',
  MarriedJoint: 'Married filing jointly',
  MarriedSeparate: 'Married filing separately',
  HeadOfHousehold: 'Head of household',
  QualifyingSurvivingSpouse: 'Qualifying surviving spouse',
};

const PRIORITY_LABELS: Record<ApiTaskPriority, string> = {
  Urgent: 'Urgent',
  High: 'High',
  Normal: 'Normal',
  Low: 'Low',
};

const TASK_STATUS_LABELS: Partial<Record<ApiTaskStatus, string>> = {
  NotStarted: 'Not started',
  InProgress: 'In progress',
  WaitingOnClient: 'Waiting on client',
};

/** Chip de prioridad (mismos tonos que la tabla del tab Work). */
const PRIORITY_CHIPS: Record<ApiTaskPriority, string> = {
  Urgent: 'border-red-200 bg-red-50 text-red-600',
  High: 'border-amber-200 bg-amber-50 text-amber-600',
  Normal: 'border-gray-200 bg-gray-50 text-gray-500',
  Low: 'border-gray-200 bg-gray-50 text-gray-400',
};

/**
 * Tab "Overview" del perfil: el "360 de un vistazo", en tarjetas con cabecera (icono + título +
 * "See all" que salta a la pestaña correspondiente): Workload (medidor animado de tareas al día vs.
 * vencidas + contadores), Client profile, Activity (tareas/emails con pestañas y tarjetas
 * desplegables), Tax snapshot y Assigned staff. Combina lo que sale del cliente real
 * (GET /customers/{id}: antigüedad, cómo contactarlo, snapshot fiscal enmascarado) con un
 * resumen agregado de tres listados REALES por cliente vía `ClientOverviewStore` — tareas
 * abiertas, documentos e hilos de email — que alimentan las stats, "Needs attention" y
 * "Recent activity". Cada agregado tolera falta de permiso (queda en 0/vacío, no rompe la vista).
 */
@Component({
  selector: 'app-client-profile-overview',
  imports: [CommonModule, CountUpDirective, ClientAssignDialogComponent, AvatarComponent, TimeAgoPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-overview.component.html',
  styleUrl: './client-profile-overview.component.css',
})
export class ClientProfileOverviewComponent implements OnChanges {
  @Input() client!: ClientProfile;
  /** Identificador completo ya revelado (lo maneja el contenedor: re-enmascara a los 30 s). */
  @Input() revealedTaxId: string | null = null;
  @Input() revealingTaxId = false;
  /** `customers.fiscalprofile.reveal`: permiso PROPIO, igual que en la pestaña Info. */
  @Input() canReveal = false;

  /** Pide el reveal auditado (el contenedor llama a `revealTaxIdentifier`). */
  @Output() revealTaxId = new EventEmitter<string>();
  /** Volver a enmascarar. */
  @Output() hideTaxId = new EventEmitter<void>();
  /** "See all" de cada tarjeta: el contenedor cambia a esa pestaña. */
  @Output() openTab = new EventEmitter<OverviewTabLink>();

  /** Confirmación de un paso antes de revelar (mismo flujo que la pestaña Info). */
  readonly confirmingReveal = signal(false);

  readonly summary = inject(ClientOverviewStore);
  private readonly staff = inject(StaffDirectoryStore);
  private readonly perms = inject(ClientPermissions);
  private readonly store = inject(ClientsStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly toast = inject(ToastService);

  // ---------- Workload (medidor) ----------

  /** El arco arranca vacío y se llena tras el primer render, para que se vea la animación. */
  readonly gaugeReady = signal(false);
  readonly onTrackCount = computed(() => Math.max(0, this.summary.openTaskCount() - this.summary.overdueCount()));
  /** % de tareas abiertas al día (sin tareas abiertas, el medidor queda lleno: nada pendiente). */
  readonly onTrackPercent = computed(() => {
    const open = this.summary.openTaskCount();
    return open === 0 ? 100 : Math.round((this.onTrackCount() / open) * 100);
  });
  /** stroke-dashoffset del arco (pathLength = 100). */
  readonly gaugeOffset = computed(() => (this.gaugeReady() ? 100 - this.onTrackPercent() : 100));

  // ---------- Activity (pestañas + tarjetas desplegables) ----------

  readonly activityTab = signal<'tasks' | 'emails'>('tasks');
  /** Tarjeta abierta (id de tarea o hilo), o null. */
  readonly expandedId = signal<string | null>(null);

  private readonly clientSignal = signal<ClientProfile | null>(null);

  /** Hora actual para cuentas regresivas (se mueve sola cada 30 s). */
  readonly now = signal(Date.now());

  // ---------- Finanzas / familia (derivados del cliente o del store) ----------

  /** Ancho (%) de la barra de cobrado; arranca en 0 para animarse al entrar. */
  readonly collectedBarPercent = computed(() => (this.gaugeReady() ? this.summary.invoiceSummary().collectedPercent : 0));

  /** Ancho (%) de cada tramo de la barra de firmas (completadas / en curso / con problema). */
  readonly signatureBars = computed(() => {
    const s = this.summary.signatureSummary();
    const total = s.completed + s.pending + s.attention + s.draft;
    const pct = (n: number) => (this.gaugeReady() && total > 0 ? (n / total) * 100 : 0);
    return { completed: pct(s.completed), pending: pct(s.pending), attention: pct(s.attention), draft: pct(s.draft) };
  });

  /** Cónyuge + dependientes. Lee `clientSignal` (el @Input clásico no es reactivo para un computed). */
  readonly familyMembers = computed(() => {
    const client = this.clientSignal();
    const members: { name: string; relation: string; age: number | null; contact: string }[] = [];
    if (client?.spouse) {
      members.push({
        name: client.spouse.name,
        relation: 'Spouse',
        age: ageFrom(client.spouse.dateOfBirth),
        contact: client.spouse.email || client.spouse.phone || '',
      });
    }
    for (const dependent of client?.dependents ?? []) {
      members.push({ name: dependent.name, relation: dependent.relationship, age: ageFrom(dependent.dateOfBirth), contact: '' });
    }
    return members;
  });

  constructor() {
    afterNextRender(() => this.gaugeReady.set(true));
    const timer = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  isAvailable(section: OverviewSection): boolean {
    return this.summary.available().has(section);
  }

  money(cents: number, currency: string): string {
    return formatMoney(cents, currency, { fromCents: true });
  }

  invoiceChip(status: SummaryInvoiceStatus): string {
    return INVOICE_CHIPS[status] ?? INVOICE_CHIPS.Draft;
  }

  invoiceLabel(status: SummaryInvoiceStatus): string {
    return INVOICE_LABELS[status] ?? status;
  }

  signatureChip(status: SummarySignatureStatus): string {
    return SIGNATURE_CHIPS[status] ?? SIGNATURE_CHIPS.Draft;
  }

  signatureLabel(status: SummarySignatureStatus): string {
    return SIGNATURE_LABELS[status] ?? status;
  }

  smsStatusClass(status: SummarySmsStatus): string {
    return SMS_CHIPS[status] ?? 'text-gray-400';
  }

  /** "Live now", "in 25m", "in 3h", "Tomorrow 9:00 AM", "Oct 12, 9:00 AM". */
  meetingWhen(meeting: SummaryMeeting): string {
    if (meeting.status === 'Live') {
      return 'Live now';
    }
    if (!meeting.scheduledForUtc) {
      return 'Not scheduled';
    }
    const at = parseUtcDate(meeting.scheduledForUtc);
    const diffMin = Math.round((at.getTime() - this.now()) / 60_000);
    if (diffMin <= 0) {
      return 'Starting now';
    }
    if (diffMin < 60) {
      return `in ${diffMin}m`;
    }
    if (diffMin < 12 * 60) {
      return `in ${Math.round(diffMin / 60)}h`;
    }
    const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const tomorrow = new Date(this.now());
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (at.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow ${time}`;
    }
    return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
  }

  /** Día y mes del meeting para el "calendario" de la tarjeta. */
  meetingDay(meeting: SummaryMeeting): { day: string; month: string } {
    const iso = meeting.scheduledForUtc ?? meeting.startedAtUtc;
    if (!iso) {
      return { day: '—', month: '' };
    }
    const at = parseUtcDate(iso);
    return { day: String(at.getDate()), month: at.toLocaleDateString('en-US', { month: 'short' }) };
  }

  /** 125 → "2m 5s". */
  duration(seconds: number | null | undefined): string {
    if (!seconds) {
      return '—';
    }
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  portalLabel(): string {
    const portal = this.summary.portal();
    return portal ? portalStatusLabel(portal.status) : 'Unknown';
  }

  portalChip(): string {
    const portal = this.summary.portal();
    return portal ? portalStatusChipClass(portal.status) : 'border-gray-200 bg-gray-50 text-gray-500';
  }

  primaryAddress(): string {
    const address = this.client.addresses.find(a => a.isPrimary) ?? this.client.addresses[0];
    if (!address) {
      return '';
    }
    return [address.line1, address.city, [address.region, address.postalCode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
  }

  clientAge(): number | null {
    return ageFrom(this.client.individual?.dateOfBirth ?? '');
  }

  setActivityTab(tab: 'tasks' | 'emails'): void {
    this.activityTab.set(tab);
    this.expandedId.set(null);
  }

  toggleExpanded(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  activityTint(index: number): string {
    return ACTIVITY_TINTS[index % ACTIVITY_TINTS.length];
  }

  async copy(value: string, label: string): Promise<void> {
    if (!value) {
      return;
    }
    if (await this.clipboard.copy(value)) {
      this.toast.success(`${label} copied`);
    } else {
      this.toast.error(`Couldn't copy the ${label.toLowerCase()}`);
    }
  }

  // Roster de asignados (solo admin/view_all lo ve; el backend no lo envía a un no-admin).
  readonly canViewAssignees = this.perms.canViewAssignees;
  readonly canAssignPreparer = this.perms.canAssignPreparer;
  private readonly _assignees = signal<CustomerAssignee[]>([]);
  readonly assignOpen = signal(false);

  /** Asignados resueltos a staff (reactivo al directorio: los avatares se rellenan al cargar). */
  readonly assigneeRows = computed(() => {
    const byId = new Map(this.staff.members().map(m => [m.userId, m]));
    return this._assignees().map(a => ({ userId: a.userId, isPrimary: a.isPrimary, member: byId.get(a.userId) }));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['client']) {
      return;
    }
    this.confirmingReveal.set(false);
    this.expandedId.set(null);
    this.clientSignal.set(this.client ?? null);
    if (this.client?.id) {
      this.summary.load(this.client.id, this.client.email);
      this._assignees.set(this.client.assignees ?? []);
      this.staff.ensureLoaded();
    }
  }

  openAssign(): void {
    this.assignOpen.set(true);
  }

  /** Al cerrar el diálogo: si hubo cambios, re-lee los asignados para refrescar la tarjeta. */
  onAssignClosed(changed: boolean): void {
    this.assignOpen.set(false);
    if (changed && this.client?.id) {
      this.store.getById(this.client.id).subscribe(detail => this._assignees.set(detail.assignees ?? []));
    }
  }

  firstName(): string {
    return this.client.displayName.trim().split(/\s+/)[0] || this.client.displayName;
  }

  // ---------- Resumen (Needs attention / Recent activity) ----------

  priorityLabel(priority: ApiTaskPriority): string {
    return PRIORITY_LABELS[priority] ?? priority;
  }

  taskStatusLabel(status: ApiTaskStatus): string {
    return TASK_STATUS_LABELS[status] ?? status;
  }

  priorityChip(priority: ApiTaskPriority): string {
    return PRIORITY_CHIPS[priority] ?? PRIORITY_CHIPS.Normal;
  }

  /** "Mar 15" a partir de YYYY-MM-DD; '' si la tarea no tiene vencimiento. */
  dueLabel(dueDate: string): string {
    if (!dueDate) {
      return '';
    }
    const date = new Date(`${dueDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  phoneDisplay(): string {
    return this.client.phone ? formatPhoneForDisplay(this.client.phone) : '—';
  }

  languageLabel(): string {
    return LANGUAGE_LABELS[this.client.language] ?? this.client.language;
  }

  channelLabel(): string {
    return CHANNEL_LABELS[this.client.preferredChannel] ?? this.client.preferredChannel;
  }

  clientSince(): string {
    const created = new Date(`${this.client.createdAt}T00:00:00`);
    const now = new Date();
    let months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (now.getDate() < created.getDate()) {
      months -= 1;
    }
    months = Math.max(0, months);
    if (months < 1) {
      return 'This month';
    }
    if (months < 12) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }

  // ---------- Snapshot fiscal (enmascarado) ----------

  get hasFiscal(): boolean {
    return this.client.fiscalProfile !== null;
  }

  taxIdKindLabel(): string {
    return this.client.fiscalProfile?.subjectKind === 'Business' ? 'EIN' : 'SSN/ITIN';
  }

  taxIdMasked(): string {
    const f = this.client.fiscalProfile;
    if (!f?.taxIdentifierLast4) {
      return '—';
    }
    return f.subjectKind === 'Business' ? `••-•••${f.taxIdentifierLast4}` : `•••-••-${f.taxIdentifierLast4}`;
  }

  requestReveal(): void {
    this.confirmingReveal.set(true);
  }

  cancelReveal(): void {
    this.confirmingReveal.set(false);
  }

  doReveal(): void {
    this.confirmingReveal.set(false);
    this.revealTaxId.emit(this.client.id);
  }

  filingLabel(): string {
    const status = this.client.fiscalProfile?.filingStatus;
    return status ? (FILING_LABELS[status] ?? status) : '—';
  }

  returningLabel(): string {
    return this.client.fiscalProfile?.isReturningCustomer ? 'Yes' : 'No';
  }
}

/** Edad a partir de YYYY-MM-DD; null si no hay fecha válida. */
function ageFrom(dateOfBirth: string): number | null {
  if (!dateOfBirth) {
    return null;
  }
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dob.getTime())) {
    return null;
  }
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday = now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}
