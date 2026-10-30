import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import {
  MEETING_INVITED_EVENT,
  MEETING_REMINDER_EVENT,
  MeetingInvitedEvent,
  MeetingReminderEvent,
} from '@core/realtime/realtime.model';

/**
 * F6 — Avisos globales de reuniones por el socket compartido, en cualquier página del shell:
 *  - `meeting.invited` con `status === 'Live'` → "X invited you to a meeting in progress" + "Join".
 *  - `meeting.reminder` (T-64) → "{title} starts in N min" + "Join".
 * "Join" lleva a `/meetings?join={meetingId}`: la agenda abre el lobby si la reunión está en vivo (o su
 * panel si todavía no empezó). El refresco de la lista lo sigue haciendo `MeetingsStore.bindRealtime`.
 * Lo arranca el shell con `import()` (fuera del bundle inicial): `start(destroyRef)` es idempotente.
 */
@Injectable({ providedIn: 'root' })
export class MeetingInviteNotifierService {
  private readonly realtime = inject(CommunicationRealtimeService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private started = false;

  start(destroyRef: DestroyRef): void {
    if (this.started) {
      return;
    }
    this.started = true;
    destroyRef.onDestroy(() => (this.started = false));

    this.realtime
      .on<MeetingInvitedEvent>(MEETING_INVITED_EVENT)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(event => {
        if (event?.status !== 'Live') {
          return; // agendada: llega por correo/in-app y aparece en la agenda; sin toast
        }
        const who = event.invitedByDisplayName?.trim() || 'Someone';
        this.toast.info(`${who} invited you to a meeting in progress`, { action: this.joinAction(event.meetingId) });
      });

    this.realtime
      .on<MeetingReminderEvent>(MEETING_REMINDER_EVENT)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(event => {
        if (!event?.meetingId) {
          return;
        }
        const title = event.title?.trim() || 'Your meeting';
        const minutes = Math.max(1, Math.round(event.minutesBefore ?? 0));
        this.toast.info(`${title} starts in ${minutes} min`, { action: this.joinAction(event.meetingId) });
      });
  }

  private joinAction(meetingId: string) {
    return { label: 'Join', run: () => void this.router.navigate(['/meetings'], { queryParams: { join: meetingId } }) };
  }
}
