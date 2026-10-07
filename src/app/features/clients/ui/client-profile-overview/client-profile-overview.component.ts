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
import { BytesPipe } from '@shared/pipes/bytes.pipe';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileResponse, FileStatus } from '@core/cloud-storage/cloud-storage.model';
import { formatMoney } from '@shared/utils/format.util';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { ClientProfileTabId } from '../../data-access/client-tab-access';
import {
  SummaryInvoiceStatus,
  SummaryMeeting,
  SummarySignatureStatus,
  SummarySmsStatus,
} from '../../data-access/client-summary.service';
import { portalStatusLabel } from '../../data-access/client-portal.model';

/** Pestañas del perfil a las que el Overview puede saltar desde sus "See all". */
export type OverviewTabLink = Exclude<ClientProfileTabId, 'overview'>;

/** Estado como icono + color de texto (sin pill de fondo), igual en todas las tarjetas. */
interface StatusTone {
  icon: string;
  text: string;
}

const INVOICE_TONES: Record<SummaryInvoiceStatus, StatusTone> = {
  Draft: { icon: 'document-outline', text: 'text-gray-400' },
  Issued: { icon: 'send-outline', text: 'text-brand-bold' },
  Sent: { icon: 'send-outline', text: 'text-brand-bold' },
  PartiallyPaid: { icon: 'time-outline', text: 'text-amber-600' },
  Paid: { icon: 'checkmark-circle', text: 'text-emerald-600' },
  Voided: { icon: 'ban-outline', text: 'text-gray-400' },
};

const INVOICE_LABELS: Record<SummaryInvoiceStatus, string> = {
  Draft: 'Draft',
  Issued: 'Issued',
  Sent: 'Sent',
  PartiallyPaid: 'Partial',
  Paid: 'Paid',
  Voided: 'Voided',
};

const SIGNATURE_TONES: Record<SummarySignatureStatus, StatusTone> = {
  Draft: { icon: 'document-outline', text: 'text-gray-400' },
  Ready: { icon: 'send-outline', text: 'text-brand-bold' },
  Scheduled: { icon: 'calendar-outline', text: 'text-brand-bold' },
  InProgress: { icon: 'time-outline', text: 'text-amber-600' },
  Completed: { icon: 'checkmark-circle', text: 'text-emerald-600' },
  Rejected: { icon: 'alert-circle-outline', text: 'text-red-600' },
  Canceled: { icon: 'ban-outline', text: 'text-gray-400' },
  Expired: { icon: 'alert-circle-outline', text: 'text-red-500' },
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

/** Archivos que todavía no se pueden abrir: se muestra su estado en vez de abrir el visor. */
const FILE_STATUS_TONES: Partial<Record<FileStatus, StatusTone & { label: string }>> = {
  PendingUpload: { icon: 'time-outline', text: 'text-gray-400', label: 'Uploading' },
  PendingScan: { icon: 'time-outline', text: 'text-gray-400', label: 'Scanning' },
  Scanning: { icon: 'time-outline', text: 'text-gray-400', label: 'Scanning' },
  PendingReview: { icon: 'eye-outline', text: 'text-amber-600', label: 'In review' },
  Infected: { icon: 'alert-circle-outline', text: 'text-red-600', label: 'Blocked' },
  BlockedByPolicy: { icon: 'alert-circle-outline', text: 'text-red-600', label: 'Blocked' },
  ScanFailed: { icon: 'alert-circle-outline', text: 'text-red-600', label: 'Scan failed' },
};

/** Reloj del Overview: refresca cuentas regresivas ("in 2h") sin recargar datos. */
const CLOCK_TICK_MS = 30_000;

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

/**
 * Tab "Overview" del perfil: el "360 de un vistazo", en tarjetas con cabecera (icono + título +
 * "See all" que salta a la pestaña correspondiente), repartidas en 3 columnas independientes (cada
 * una apila sus tarjetas, sin huecos): Workload (dona de tareas por estado), Finance, Notes, SMS |
 * Client profile, Recent documents, Assigned staff, Signatures, Calls | Meetings, Activity, Household, Client portal.
 * Combina lo que sale del cliente real (GET /customers/{id}: antigüedad, cómo contactarlo) con un
 * resumen agregado de tres listados REALES por cliente vía `ClientOverviewStore` — tareas
 * abiertas, documentos e hilos de email — que alimentan las stats, "Needs attention" y
 * "Recent activity". Cada agregado tolera falta de permiso (queda en 0/vacío, no rompe la vista).
 */
@Component({
  selector: 'app-client-profile-overview',
  imports: [
    CommonModule,
    CountUpDirective,
    ClientAssignDialogComponent,
    AvatarComponent,
    TimeAgoPipe,
    BytesPipe,
    FileViewerComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-overview.component.html',
  styleUrl: './client-profile-overview.component.css',
})
export class ClientProfileOverviewComponent implements OnChanges {
  @Input() client!: ClientProfile;
  /** "See all" de cada tarjeta: el contenedor cambia a esa pestaña. */
  @Output() openTab = new EventEmitter<OverviewTabLink>();

  readonly summary = inject(ClientOverviewStore);
  private readonly staff = inject(StaffDirectoryStore);
  private readonly perms = inject(ClientPermissions);
  private readonly store = inject(ClientsStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly toast = inject(ToastService);

  // ---------- Workload (dona por estado) ----------

  /** Las barras y la dona arrancan vacías y se llenan tras el primer render, para que se vea la animación. */
  readonly gaugeReady = signal(false);
  /** Abiertas que no están vencidas (incluye las que vencen esta semana). */
  readonly onTrackCount = computed(() => Math.max(0, this.summary.openTaskCount() - this.summary.overdueCount()));
  /** Al día y sin vencimiento cercano: el tramo "On track" de la leyenda. */
  readonly onTrackLaterCount = computed(() => Math.max(0, this.onTrackCount() - this.summary.dueThisWeekCount()));
  /** % de tareas abiertas al día (centro de la dona). */
  readonly onTrackPercent = computed(() => {
    const open = this.summary.openTaskCount();
    return open === 0 ? 100 : Math.round((this.onTrackCount() / open) * 100);
  });

  /**
   * Tramos de la dona (circle con pathLength = 100): `dash` = "largo hueco" y `offset` negativo
   * acumulado para encadenarlos. Con más de un tramo se deja una separación fina entre ellos.
   */
  readonly donutSegments = computed(() => {
    const open = this.summary.openTaskCount();
    if (open === 0) {
      return [];
    }
    const parts = [
      { key: 'on-track', value: this.onTrackLaterCount(), stroke: 'stroke-brand-bold' },
      { key: 'due-soon', value: this.summary.dueThisWeekCount(), stroke: 'stroke-brand-light' },
      { key: 'overdue', value: this.summary.overdueCount(), stroke: 'stroke-red-500' },
    ].filter(part => part.value > 0);
    const gap = parts.length > 1 ? 1.5 : 0;
    let start = 0;
    return parts.map(part => {
      const length = (part.value / open) * 100;
      const visible = this.gaugeReady() ? Math.max(length - gap, 0.5) : 0;
      const segment = { key: part.key, stroke: part.stroke, dash: `${visible} ${100 - visible}`, offset: -start };
      start += length;
      return segment;
    });
  });

  // ---------- Documentos recientes (visor global) ----------

  readonly viewerOpen = signal(false);
  readonly viewerIndex = signal(0);
  /** Solo los que ya se pueden abrir: el visor no debe pasar por uno que se está escaneando. */
  readonly viewerFiles = computed(() =>
    this.summary.recentDocumentViewerItems().filter(item => (item.ref as FileResponse).status === 'Available'),
  );

  /** Abre el visor en ese archivo; los que aún no están disponibles llevan a la pestaña Documents. */
  openDocument(file: FileResponse): void {
    const index = this.viewerFiles().findIndex(item => (item.ref as FileResponse).id === file.id);
    if (index < 0) {
      this.openTab.emit('documents');
      return;
    }
    this.viewerIndex.set(index);
    this.viewerOpen.set(true);
  }

  /** Estado a mostrar si el archivo no está listo; null si está disponible. */
  fileStatusTone(file: FileResponse): (StatusTone & { label: string }) | null {
    return file.status === 'Available' ? null : (FILE_STATUS_TONES[file.status] ?? null);
  }

  /** Icono y color del cuadro según el tipo del archivo (PDF, imagen, hoja de cálculo u otro). */
  fileKind(file: FileResponse): { icon: string; tile: string } {
    const type = (file.detectedContentType || file.declaredContentType || '').toLowerCase();
    const name = file.originalName.toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) {
      return { icon: 'document-text-outline', tile: 'bg-red-50 text-red-600' };
    }
    if (type.startsWith('image/')) {
      return { icon: 'image-outline', tile: 'bg-emerald-50 text-emerald-600' };
    }
    if (type.includes('sheet') || type.includes('excel') || type === 'text/csv' || /\.(xlsx?|csv)$/.test(name)) {
      return { icon: 'grid-outline', tile: 'bg-emerald-50 text-emerald-600' };
    }
    return { icon: 'document-outline', tile: 'bg-brand-surface text-brand-bold' };
  }

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

  invoiceTone(status: SummaryInvoiceStatus): StatusTone {
    return INVOICE_TONES[status] ?? INVOICE_TONES.Draft;
  }

  invoiceLabel(status: SummaryInvoiceStatus): string {
    return INVOICE_LABELS[status] ?? status;
  }

  signatureTone(status: SummarySignatureStatus): StatusTone {
    return SIGNATURE_TONES[status] ?? SIGNATURE_TONES.Draft;
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

  /** "Aug 28, 2026" a partir de la fecha de alta. */
  clientSinceDate(): string {
    const created = new Date(`${this.client.createdAt}T00:00:00`);
    return Number.isNaN(created.getTime())
      ? ''
      : created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
