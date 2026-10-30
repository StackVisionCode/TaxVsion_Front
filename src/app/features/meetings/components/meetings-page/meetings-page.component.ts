import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import {
  ScheduleMeetingDeepLink,
  customerInviteeDraft,
  hasScheduleMeetingParams,
  parseScheduleMeetingDeepLink,
  wantsBlankSchedule,
} from '../../utils/schedule-deep-link';
import { Observable } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClipboardService } from '@shared/services/clipboard.service';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { LoadMoreComponent } from '@shared/ui/load-more/load-more.component';
import { MeetingListComponent } from '../../ui/meeting-list/meeting-list.component';
import { MeetingSchedulePanelComponent } from '../../ui/meeting-schedule-panel/meeting-schedule-panel.component';
import { MeetingInvitePanelComponent } from '../../ui/meeting-invite-panel/meeting-invite-panel.component';
import { MeetingLobbyTarget, MeetingRoomComponent } from '../../ui/meeting-room/meeting-room.component';
import { ActiveMeetingService } from '@core/communication/active-meeting.service';
import { ActiveCallService } from '@core/communication/active-call.service';
import { MeetingSessionState } from '@core/communication/meeting-session-state';
import { MeetingCreationOutcome, MeetingsStore } from '../../data-access/meetings.store';
import { MeetingFormValue, MeetingInviteeDraft, MeetingItem, MeetingsScope } from '../../data-access/meeting.model';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';

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
 *
 * Modo embebido (`injectEmbeddedCustomer()`): lo monta `ClientMeetingsWorkspaceComponent` en el
 * perfil del cliente. El store filtra por ese cliente, no se leen query params y "Schedule meeting"
 * abre el panel con el cliente ya invitado. La sala en vivo se renderiza igual que en /meetings
 * (la sala marca `roomViewAttached` y el mini-player global se oculta mientras está montada).
 *
 * F6: panel "Invite" de la sala (`app-meeting-invite-panel`, abierto por `inviteRequested` de la sala o
 * por `MeetingSessionState.invitePanelRequested` desde el mini-player) y deep link `?join={meetingId}`
 * (toasts "invited you to a meeting in progress" / recordatorio): lobby si está Live, panel si no empezó.
 */
@Component({
  selector: 'app-meetings-page',
  imports: [
    CommonModule,
    MeetingListComponent,
    MeetingSchedulePanelComponent,
    MeetingInvitePanelComponent,
    MeetingRoomComponent,
    FilterChipsComponent,
    SearchInputComponent,
    StateBlockComponent,
    LoadMoreComponent,
    FileViewerComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meetings-page.component.html',
})
export class MeetingsPageComponent implements OnInit {
  readonly store = inject(MeetingsStore);
  private readonly activeMeeting = inject(ActiveMeetingService);
  private readonly activeCall = inject(ActiveCallService);
  private readonly toast = inject(ToastService);
  private readonly clipboard = inject(ClipboardService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly directory = inject(CustomerDirectoryStore);

  private readonly embeddedCustomer = injectEmbeddedCustomer();
  readonly embedded = computed(() => this.embeddedCustomer() !== null);
  /** Subtítulo de la cabecera (embebido: el cliente). */
  readonly subtitle = computed(() => {
    const customer = this.embeddedCustomer();
    return customer ? `Meetings with ${customer.name}` : 'Your schedule at a glance';
  });

  /** Invitados precargados del panel de agendar (deep link desde el perfil del cliente). */
  readonly initialInvitees = signal<MeetingInviteeDraft[]>([]);

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
  private readonly pendingMeetingId = signal<string | null>(null);
  private readonly meetingDeepLinkEffect = effect(() => {
    const meetingId = this.pendingMeetingId();
    if (!meetingId) {
      return;
    }
    const upcoming = this.store.upcoming().find(meeting => meeting.id === meetingId);
    const past = this.store.past().find(meeting => meeting.id === meetingId);
    const meeting = upcoming ?? past;
    if (meeting) {
      untracked(() => {
        this.activeTab.set(upcoming ? 'upcoming' : 'past');
        this.openManagePanel(meeting);
        this.pendingMeetingId.set(null);
      });
      return;
    }
    if (this.store.isScopeLoaded('upcoming') && this.store.isScopeLoaded('past')) {
      untracked(() => {
        this.pendingMeetingId.set(null);
        this.toast.info('This meeting is no longer available.');
      });
    }
  });

  /** Fila con una acción en curso (start/end/cancel): deshabilita sus botones. */
  readonly busyId = signal<string | null>(null);

  /**
   * La sala se muestra mientras hay un meeting ACTIVO en el ActiveMeetingService (root), venga de un
   * join en esta página o de volver desde el mini-player global: al entrar a /meetings con una sesión
   * viva se muestra la sala de ESE meeting sin re-unirse. Cuando la fase vuelve a 'idle' (salí, me
   * sacaron o el join falló) se oculta y volvemos a la lista — el template de la sala no tiene rama
   * 'idle' (antes quedaba una tarjeta en BLANCO que obligaba a refrescar).
   */
  readonly showRoom = computed(() => this.activeMeeting.phase() !== 'idle' || this.pendingJoin() !== null);
  /** F4 (D-45): reunión elegida en la agenda; la sala muestra el lobby (pre-join) hasta que entre o cancele. */
  readonly pendingJoin = signal<MeetingLobbyTarget | null>(null);

  // ---------- F6: panel Invite de la sala ----------
  private readonly session = inject(MeetingSessionState);
  readonly inviteOpen = signal(false);
  readonly activeMeetingId = this.activeMeeting.meetingId;
  /** Código corto de la reunión activa (la sala no lo conoce; sale de la agenda cargada). */
  readonly activeShortCode = computed(() => {
    const id = this.activeMeetingId();
    return id ? ([...this.store.upcoming(), ...this.store.past()].find(m => m.id === id)?.shortCode ?? null) : null;
  });
  /** El mini-player pidió "Invite": con la sala montada se abre el panel y se consume el flag. */
  private readonly invitePanelRequestEffect = effect(() => {
    if (this.session.invitePanelRequested() && this.activeMeeting.phase() === 'joined') {
      untracked(() => {
        this.session.invitePanelRequested.set(false);
        this.inviteOpen.set(true);
      });
    }
  });

  openInvitePanel(): void {
    if (this.activeMeetingId()) {
      this.inviteOpen.set(true);
    }
  }

  ngOnInit(): void {
    this.store.bindRealtime();
    this.store.loadScope('upcoming');
  }

  // ---------- F6: deep link ?join={meetingId} (toasts "Join") ----------
  private consumedJoinId: string | null = null;
  private readonly pendingJoinId = signal<string | null>(null);
  private readonly joinDeepLinkEffect = effect(() => {
    if (this.embedded()) return;
    const meetingId = this.routeParams().get('join');
    if (!meetingId || this.consumedJoinId === meetingId) return;
    this.consumedJoinId = meetingId;
    untracked(() => {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      this.pendingJoinId.set(meetingId);
      this.store.loadScope('upcoming');
    });
  });
  private readonly joinResolveEffect = effect(() => {
    const meetingId = this.pendingJoinId();
    if (!meetingId) return;
    const meeting = this.store.upcoming().find(m => m.id === meetingId);
    if (meeting) {
      untracked(() => {
        this.pendingJoinId.set(null);
        if (meeting.apiStatus === 'Live') {
          this.joinMeeting(meeting);
        } else {
          this.openManagePanel(meeting);
          this.toast.info("This meeting hasn't started yet.");
        }
      });
      return;
    }
    if (this.store.isScopeLoaded('upcoming') && !this.store.loading()) {
      untracked(() => {
        this.pendingJoinId.set(null);
        this.toast.info('This meeting is no longer available.');
      });
    }
  });

  /** Deep links reactivos: estando ya en /meetings, abrir otra notificacion de meeting
   *  cambia los queryParams pero no vuelve a disparar ngOnInit. */
  private readonly routeParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private consumedMeetingId: string | null = null;
  private consumedScheduleLink: string | null = null;
  private readonly meetingIdDeepLinkEffect = effect(() => {
    if (this.embedded()) return;
    const meetingId = this.routeParams().get('meetingId');
    if (!meetingId || this.consumedMeetingId === meetingId) return;
    this.consumedMeetingId = meetingId;
    untracked(() => {
      this.pendingMeetingId.set(meetingId);
      this.store.loadScope('past');
    });
  });

  private readonly scheduleDeepLinkEffect = effect(() => {
    if (this.embedded()) return;
    const params = this.routeParams();
    if (!hasScheduleMeetingParams(params) && !wantsBlankSchedule(params)) return;
    const key = `${params.get('schedule') ?? ''}|${params.get('customerId') ?? ''}|${params.get('customerName') ?? ''}`;
    if (this.consumedScheduleLink === key) return;
    this.consumedScheduleLink = key;
    untracked(() => {
      const link = parseScheduleMeetingDeepLink(params);
      if (hasScheduleMeetingParams(params)) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      }
      if (!this.store.canCreate()) return;
      if (!link) {
        if (wantsBlankSchedule(params)) {
          this.openSchedulePanel();
        }
        return;
      }
      this.directory.byId([link.customerId]).subscribe({
        next: found => this.openScheduleFor(link, found.get(link.customerId) ?? null),
        error: () => this.openScheduleFor(link, null),
      });
    });
  });

  private openScheduleFor(
    link: ScheduleMeetingDeepLink,
    customer: { displayName: string; primaryEmail: string } | null,
  ): void {
    this.initialInvitees.set([customerInviteeDraft(link, customer)]);
    this.managingMeeting.set(null);
    this.panelError.set(null);
    this.creationOutcome.set(null);
    this.isPanelOpen.set(true);
  }

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
    const customer = this.embeddedCustomer();
    if (customer) {
      // Embebido: mismo flujo del deep link, con el cliente del perfil ya invitado.
      const link: ScheduleMeetingDeepLink = { customerId: customer.id, customerName: customer.name };
      this.directory.byId([customer.id]).subscribe({
        next: found => this.openScheduleFor(link, found.get(customer.id) ?? null),
        error: () => this.openScheduleFor(link, null),
      });
      return;
    }
    this.initialInvitees.set([]);
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
    this.initialInvitees.set([]);
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
        const apiError = toApiError(err);
        this.panelError.set(apiError.message);
        // F3: límites de la oficina/plan (duración por encima del máximo, tamaño de reunión) también en toast.
        if (apiError.code === 'Meeting.InvalidDuration' || apiError.code === 'Plan.MeetingSizeExceeded') {
          this.toast.error(apiError.message);
        }
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

  /**
   * Entra a la sala real (Socket.IO): solo meetings Live. Primero el lobby (vista previa, dispositivos,
   * join muted / camera off); el lobby llama a `ActiveMeetingService.join`. T-58: con una llamada en
   * curso no hay lobby: `join()` avisa con "Leave and join" sin capturar nada.
   */
  joinMeeting(meeting: MeetingItem): void {
    if (this.activeCall.phase() !== 'idle') {
      void this.activeMeeting.join(meeting.id, meeting.title);
      return;
    }
    this.pendingJoin.set({ meetingId: meeting.id, title: meeting.title });
  }

  copyCode(meeting: MeetingItem): void {
    void this.clipboard.copy(meeting.shortCode).then(copied =>
      copied ? this.toast.success(`Code ${meeting.shortCode} copied`) : this.toast.error('Could not copy the code'),
    );
  }

  /** Visor global del transcript (antes se abría en otra pestaña). */
  readonly transcriptViewerFiles = signal<FileViewerItem[]>([]);
  readonly transcriptViewerOpen = signal(false);

  /** Abre el transcript (CloudStorage) en el visor global; solo si el meeting lo tiene. */
  viewTranscript(meeting: MeetingItem): void {
    if (!meeting.transcriptFileId) {
      return;
    }
    this.store.transcriptViewerItem(meeting.transcriptFileId).subscribe({
      next: item => {
        this.transcriptViewerFiles.set([item]);
        this.transcriptViewerOpen.set(true);
      },
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
