import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
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
  imports: [CommonModule, FormsModule, MeetingListComponent, MeetingSchedulePanelComponent, MeetingRoomComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meetings-page.component.html',
})
export class MeetingsPageComponent implements OnInit {
  readonly store = inject(MeetingsStore);
  private readonly activeMeeting = inject(ActiveMeetingService);

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
  readonly toastMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.store.loadScope('upcoming');
  }

  // ---------- Stats (sobre lo cargado del scope actual) ----------

  readonly todayCount = computed(() => {
    const now = new Date();
    return this.store
      .upcoming()
      .filter(meeting => meeting.status === 'upcoming' || meeting.status === 'live')
      .filter(meeting => {
        if (meeting.status === 'live') {
          return true;
        }
        return !!meeting.scheduledAt && new Date(meeting.scheduledAt).toDateString() === now.toDateString();
      }).length;
  });

  readonly thisWeekCount = computed(() => {
    const weekFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
    return this.store
      .upcoming()
      .filter(
        meeting =>
          meeting.status === 'live' ||
          (!!meeting.scheduledAt && new Date(meeting.scheduledAt).getTime() <= weekFromNow),
      ).length;
  });

  readonly liveNowCount = computed(() => this.store.upcoming().filter(meeting => meeting.status === 'live').length);

  /** Transcripts disponibles en el historial cargado (reemplaza al "recordings" del mock). */
  readonly transcriptsCount = computed(() => this.store.past().filter(meeting => !!meeting.transcriptFileId).length);

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
        this.showToast('Meeting rescheduled');
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
    navigator.clipboard?.writeText(meeting.shortCode).then(
      () => this.showToast(`Code ${meeting.shortCode} copied`),
      () => this.showToast('Could not copy the code'),
    );
  }

  /** Descarga presignada del transcript (CloudStorage); solo si el meeting lo tiene. */
  viewTranscript(meeting: MeetingItem): void {
    if (!meeting.transcriptFileId) {
      return;
    }
    this.store.transcriptUrl(meeting.transcriptFileId).subscribe({
      next: url => window.open(url, '_blank', 'noopener'),
      error: err => this.showToast(toApiError(err).message),
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
        this.showToast(successMessage);
      },
      error: err => {
        this.busyId.set(null);
        this.showToast(toApiError(err).message);
      },
    });
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2500);
  }
}
