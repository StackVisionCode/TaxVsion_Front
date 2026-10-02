import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClipboardService } from '@shared/services/clipboard.service';
import { StatCardItem, StatCardsComponent } from '@shared/ui/stat-cards/stat-cards.component';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { LoadMoreComponent } from '@shared/ui/load-more/load-more.component';
import { MeetingListComponent } from '../../ui/meeting-list/meeting-list.component';
import { MeetingSchedulePanelComponent } from '../../ui/meeting-schedule-panel/meeting-schedule-panel.component';
import { MeetingRoomComponent } from '../../ui/meeting-room/meeting-room.component';
import { ActiveMeetingService } from '@core/communication/active-meeting.service';
import { MeetingCreationOutcome, MeetingsStore } from '../../data-access/meetings.store';
import { MeetingFormValue, MeetingItem, MeetingsScope } from '../../data-access/meeting.model';

/**
 * Página del módulo Meetings conectada a Communication (`/communication/meetings`):
 * agenda con pestañas Upcoming/Past (listados server-side con paginación "load more"),
 * panel de agendar (create + invitaciones, que devuelve los joinUrl una única vez) y
 * gestión del ciclo de vida por fila (start/end/cancel/reschedule, host-only).
 *
 * Diferencias con el mock: la búsqueda es client-side sobre lo cargado (el listado no
 * expone `term`), no hay "cliente" ni duración planificada en el contrato, y las
 * grabaciones del mock se reemplazan por el transcript real (descarga presignada de
 * CloudStorage) cuando el meeting tiene `transcriptFileId`.
 */
@Component({
  selector: 'app-meetings-page',
  imports: [
    CommonModule,
    MeetingListComponent,
    MeetingSchedulePanelComponent,
    MeetingRoomComponent,
    StatCardsComponent,
    FilterChipsComponent,
    SearchInputComponent,
    StateBlockComponent,
    LoadMoreComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meetings-page.component.html',
})
export class MeetingsPageComponent implements OnInit {
  readonly store = inject(MeetingsStore);
  private readonly activeMeeting = inject(ActiveMeetingService);
  private readonly toast = inject(ToastService);
  private readonly clipboard = inject(ClipboardService);

  readonly tabOptions: FilterChipOption<MeetingsScope>[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  readonly activeTab = signal<MeetingsScope>('upcoming');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly managingMeeting = signal<MeetingItem | null>(null);
  readonly panelBusy = signal(false);
  readonly panelError = signal<string | null>(null);
  /** Links de invitación recién emitidos: el backend no los vuelve a exponer. */
  readonly creationOutcome = signal<MeetingCreationOutcome | null>(null);

  /** Fila con una acción en curso (start/end/cancel): deshabilita sus botones. */
  readonly busyId = signal<string | null>(null);
  readonly activeRoomMeeting = signal<MeetingItem | null>(null);

  /**
   * La sala se muestra solo mientras hay un meeting ACTIVO. Cuando la fase vuelve a 'idle' (salí, me
   * sacaron o el join falló) se oculta y volvemos a la lista. Sin esto el `<app-meeting-room>` quedaba
   * montado con phase='idle' y el template no tiene rama para 'idle' → tarjeta en BLANCO que obligaba a
   * refrescar (pasaba tras salir, porque `reset()` pone 'idle' por caminos que no limpian activeRoomMeeting).
   */
  readonly showRoom = computed(() => !!this.activeRoomMeeting() && this.activeMeeting.phase() !== 'idle');

  ngOnInit(): void {
    this.store.bindRealtime();
    this.store.loadScope('upcoming');
    this.store.loadStats();
  }

  // ---------- Stats (sobre lo cargado del scope actual) ----------

  // Contadores reales del backend (GET /meetings/stats): cuentan sobre TODOS los meetings del usuario,
  // no la página cargada en el cliente — antes "Transcripts" siempre daba 0 (la pestaña "past" era lazy)
  // y el resto contaba solo la primera página de "upcoming".
  readonly todayCount = computed(() => this.store.stats().today);
  readonly thisWeekCount = computed(() => this.store.stats().thisWeek);
  readonly liveNowCount = computed(() => this.store.stats().liveNow);
  readonly transcriptsCount = computed(() => this.store.stats().transcriptsAvailable);

  readonly stats = computed<StatCardItem[]>(() => [
    { label: "Today's meetings", value: this.todayCount() },
    { label: 'This week', value: this.thisWeekCount() },
    { label: 'Live now', value: this.liveNowCount() },
    { label: 'Transcripts available', value: this.transcriptsCount() },
  ]);

  // ---------- Listado ----------

  readonly visibleMeetings = computed<MeetingItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const meetings = this.store.meetingsFor(this.activeTab());
    return query
      ? meetings.filter(
          meeting =>
            meeting.title.toLowerCase().includes(query) || meeting.shortCode.toLowerCase().includes(query),
        )
      : meetings;
  });

  readonly hasMore = computed(() => this.store.hasMore(this.activeTab()));

  setTab(tab: MeetingsScope): void {
    this.activeTab.set(tab);
    this.store.loadScope(tab);
  }

  loadMore(): void {
    this.store.loadMore(this.activeTab());
  }

  retryLoad(): void {
    this.store.loadScope(this.activeTab(), true);
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  // ---------- Panel de agendar / gestionar ----------

  openSchedulePanel(): void {
    this.managingMeeting.set(null);
    this.panelError.set(null);
    this.creationOutcome.set(null);
    this.isPanelOpen.set(true);
  }

  openManagePanel(meeting: MeetingItem): void {
    this.managingMeeting.set(meeting);
    this.panelError.set(null);
    this.creationOutcome.set(null);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    if (this.panelBusy()) {
      return;
    }
    this.isPanelOpen.set(false);
    this.managingMeeting.set(null);
    this.panelError.set(null);
    this.creationOutcome.set(null);
  }

  /** POST /meetings (+ invitations): el outcome mantiene el panel abierto en el paso de links. */
  handleCreate(form: MeetingFormValue): void {
    if (this.panelBusy()) {
      return;
    }
    this.panelBusy.set(true);
    this.panelError.set(null);
    this.store.createMeeting(form).subscribe({
      next: outcome => {
        this.panelBusy.set(false);
        this.creationOutcome.set(outcome);
      },
      error: err => {
        this.panelBusy.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }

  handleReschedule(event: { meeting: MeetingItem; scheduledForUtc: string | null }): void {
    if (this.panelBusy()) {
      return;
    }
    this.panelBusy.set(true);
    this.panelError.set(null);
    this.store.rescheduleMeeting(event.meeting.id, event.scheduledForUtc).subscribe({
      next: () => {
        this.panelBusy.set(false);
        this.isPanelOpen.set(false);
        this.managingMeeting.set(null);
        this.toast.success('Meeting rescheduled');
      },
      error: err => {
        this.panelBusy.set(false);
        this.panelError.set(toApiError(err).message);
      },
    });
  }

  // ---------- Ciclo de vida por fila (host-only en el backend) ----------

  startMeeting(meeting: MeetingItem): void {
    this.runRowAction(meeting, this.store.startMeeting(meeting.id), 'Meeting started');
  }

  endMeeting(meeting: MeetingItem): void {
    this.runRowAction(meeting, this.store.endMeeting(meeting.id), 'Meeting ended');
  }

  cancelMeeting(meeting: MeetingItem): void {
    this.runRowAction(meeting, this.store.cancelMeeting(meeting.id), 'Meeting cancelled');
  }

  /** Entra a la sala real (Socket.IO): solo meetings Live. El ActiveMeetingService maneja el join/espera. */
  joinMeeting(meeting: MeetingItem): void {
    this.activeRoomMeeting.set(meeting);
    void this.activeMeeting.join(meeting.id, meeting.title);
  }

  leaveMeeting(): void {
    this.activeRoomMeeting.set(null);
  }

  copyCode(meeting: MeetingItem): void {
    void this.clipboard.copy(meeting.shortCode).then(copied =>
      copied ? this.toast.success(`Code ${meeting.shortCode} copied`) : this.toast.error('Could not copy the code'),
    );
  }

  /** Descarga presignada del transcript (CloudStorage); solo si el meeting lo tiene. */
  viewTranscript(meeting: MeetingItem): void {
    if (!meeting.transcriptFileId) {
      return;
    }
    this.store.transcriptUrl(meeting.transcriptFileId).subscribe({
      next: url => window.open(url, '_blank', 'noopener'),
      error: err => this.toast.error(toApiError(err).message),
    });
  }

  private runRowAction(meeting: MeetingItem, action: Observable<void>, successMessage: string): void {
    if (this.busyId()) {
      return;
    }
    this.busyId.set(meeting.id);
    action.subscribe({
      next: () => {
        this.busyId.set(null);
        this.toast.success(successMessage);
      },
      error: err => {
        this.busyId.set(null);
        this.toast.error(toApiError(err).message);
      },
    });
  }
}
