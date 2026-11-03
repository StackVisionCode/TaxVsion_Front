import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { ClipboardService } from '@shared/services/clipboard.service';
import { toApiError } from '@core/models/api-error.model';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingGuestAccess } from '../../data-access/meeting.model';

const COPIED_FEEDBACK_MS = 2000;

/** Copy por `code` del backend (el resto cae al `message` del error). */
const ERROR_COPY: Record<string, string> = {
  'Meeting.GuestsNotAllowed': "Your office doesn't allow external guests.",
  'Meeting.HostOnly': 'Only the host or a co-host can change this.',
  'Meeting.NotJoinable': 'This meeting has ended.',
};

/**
 * D-68/D-69 — Acceso de invitados externos de UNA reunión (host/cohost), reutilizado por el panel
 * "Invite" de la sala y por "Manage Meeting":
 *  - "Allow external guests": se cambia en vivo; al apagarlo, los externos que esperaban quedan rechazados.
 *  - "Meeting link": enlace compartible (cada persona entra como guest distinto y espera a que la
 *    admitan; bloquear la reunión lo frena). Create / Copy / New link (invalida el anterior) / Turn off.
 *
 *   <app-meeting-guest-access [meetingId]="id" (accessChange)="access.set($event)" />
 */
@Component({
  selector: 'app-meeting-guest-access',
  imports: [SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-guest-access.component.html',
})
export class MeetingGuestAccessComponent implements OnChanges {
  @Input() meetingId: string | null = null;
  /** Estado vigente tras cargar o cambiar: el padre decide si deja agregar externos. */
  @Output() accessChange = new EventEmitter<MeetingGuestAccess>();

  private readonly store = inject(MeetingsStore);
  private readonly clipboard = inject(ClipboardService);

  readonly access = signal<MeetingGuestAccess | null>(null);
  readonly loading = signal(false);
  /** Acción en curso: el switch pulsa o el botón del enlace muestra su texto de espera. */
  readonly busy = signal<'access' | 'link' | null>(null);
  readonly error = signal<string | null>(null);
  readonly copied = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['meetingId']) {
      this.access.set(null);
      this.error.set(null);
      this.copied.set(false);
      this.load();
    }
  }

  load(): void {
    const meetingId = this.meetingId;
    if (!meetingId) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.store.getGuestAccess(meetingId).subscribe({
      next: access => {
        this.loading.set(false);
        this.apply(access);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  setAllowed(allowed: boolean): void {
    const meetingId = this.meetingId;
    if (meetingId) {
      this.run('access', this.store.setGuestAccess(meetingId, allowed));
    }
  }

  createLink(): void {
    const meetingId = this.meetingId;
    if (meetingId) {
      this.run('link', this.store.enableGuestLink(meetingId, false));
    }
  }

  /** Nuevo enlace: el anterior deja de servir para quien no haya entrado todavía. */
  rotateLink(): void {
    const meetingId = this.meetingId;
    if (meetingId) {
      this.run('link', this.store.enableGuestLink(meetingId, true));
    }
  }

  turnOffLink(): void {
    const meetingId = this.meetingId;
    if (meetingId) {
      this.run('link', this.store.disableGuestLink(meetingId));
    }
  }

  copyLink(): void {
    const url = this.access()?.guestLinkUrl;
    if (!url) {
      return;
    }
    void this.clipboard.copy(url).then(copied => {
      if (!copied) {
        return;
      }
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), COPIED_FEEDBACK_MS);
    });
  }

  private run(kind: 'access' | 'link', request: Observable<MeetingGuestAccess>): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(kind);
    this.error.set(null);
    request.subscribe({
      next: access => {
        this.busy.set(null);
        this.copied.set(false);
        this.apply(access);
      },
      error: err => {
        this.busy.set(null);
        this.error.set(this.messageOf(err));
      },
    });
  }

  private apply(access: MeetingGuestAccess): void {
    this.access.set(access);
    this.accessChange.emit(access);
  }

  private messageOf(err: unknown): string {
    const apiError = toApiError(err);
    return ERROR_COPY[apiError.code] ?? apiError.message;
  }
}
