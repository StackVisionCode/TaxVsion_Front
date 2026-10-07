import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
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
import { ClientOverviewStore } from '../../data-access/client-overview.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import { ClientsStore } from '../../data-access/clients.store';
import { StaffDirectoryStore } from '../../data-access/staff-directory.store';
import { ClientAssignDialogComponent } from '../client-assign-dialog/client-assign-dialog.component';
import { CountUpDirective } from '@shared/directives/count-up.directive';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { formatPhoneForDisplay } from '@shared/utils/phone.util';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ToastService } from '@shared/ui/toast/toast.service';

/** Pestañas del perfil a las que el Overview puede saltar desde sus "See all". */
export type OverviewTabLink = 'work' | 'documents' | 'communication' | 'info';

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
  imports: [CommonModule, CountUpDirective, ClientAssignDialogComponent, AvatarComponent],
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

  constructor() {
    afterNextRender(() => this.gaugeReady.set(true));
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
    if (this.client?.id) {
      this.summary.load(this.client.id);
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
