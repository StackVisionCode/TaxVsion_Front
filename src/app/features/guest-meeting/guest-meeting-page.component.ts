import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { ActiveMeetingService } from '@core/communication/active-meeting.service';
import { MediaPolicyService } from '@core/communication/media/media-policy.service';
import { MeetingActiveSpeakerService } from '@core/communication/meeting-active-speaker.service';
import { LobbyJoinOptions, MediaLobbyComponent } from '@core/communication/ui/media-lobby/media-lobby.component';
import { MeetingRemoteAudioComponent } from '@core/communication/ui/remote-audio/meeting-remote-audio.component';
import { MeetingRoomComponent } from '@features/meetings/ui/meeting-room/meeting-room.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { GuestMeetingService } from './data-access/guest-meeting.service';
import { GUESTS_NOT_ALLOWED_CODE, GuestJoinByTokenResponse, GuestMeetingContext } from './data-access/guest-meeting.model';

/**
 * Pantallas de la página. `room` delega en `app-meeting-room` (sala de espera / dentro / fin);
 * `left` = me fui (Rejoin); `revoked` = el host revocó mi invitación; `failed` = no se pudo entrar (Try again).
 */
export type GuestPageState = 'loading' | 'invalid' | 'guests-off' | 'ended' | 'name' | 'lobby' | 'connecting' | 'room' | 'left' | 'revoked' | 'failed';

const MAX_NAME_LENGTH = 80;

/**
 * F6 (D-47) — Página PÚBLICA de invitado externo `/meet/:token` (fuera del shell, sin `authGuard`, sin JWT).
 *
 * Flujo: `POST guest/context` → (404 uniforme → "not valid" · `guestsAllowed:false` → "no guests" ·
 * `Ended` → "has ended") → nombre visible (prefill `inviteeName`) → `app-media-lobby` con la política del
 * contexto (`MediaPolicyService.prime`) → `POST join-by-token` → `connectAsGuest(ticket)` →
 * `ActiveMeetingService.joinAsGuest` → `app-meeting-room` en modo guest (sala de espera, revocación,
 * fin sin "Start a new meeting", Leave con "Rejoin" mientras el ticket/socket viva).
 *
 * Autónoma: no toca `MeetingSessionState` del shell ni el mini-player; el audio remoto lo reproduce
 * `app-meeting-remote-audio` aquí. Al destruirse sale de la reunión y cierra el socket.
 */
@Component({
  selector: 'app-guest-meeting-page',
  imports: [FormsModule, BrandLogoComponent, InfinityLoaderComponent, MediaLobbyComponent, MeetingRoomComponent, MeetingRemoteAudioComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './guest-meeting-page.component.html',
})
export class GuestMeetingPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(GuestMeetingService);
  private readonly realtime = inject(CommunicationRealtimeService);
  private readonly meeting = inject(ActiveMeetingService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly speaker = inject(MeetingActiveSpeakerService);
  private readonly title = inject(Title);

  readonly state = signal<GuestPageState>('loading');
  readonly context = signal<GuestMeetingContext | null>(null);
  readonly displayName = signal('');
  /** Mensaje de la pantalla `failed`. */
  readonly failure = signal<string | null>(null);
  readonly phase = this.meeting.phase;

  readonly maxNameLength = MAX_NAME_LENGTH;
  readonly meetingTitle = computed(() => this.context()?.meetingTitle || 'Meeting');
  readonly canContinue = computed(() => this.displayName().trim().length > 0);
  /** "Hosted by X · Oct 30, 3:00 PM · 45 min" (lo que haya). */
  readonly meetingMeta = computed(() => {
    const ctx = this.context();
    if (!ctx) {
      return '';
    }
    const parts: string[] = [];
    if (ctx.hostDisplayName) {
      parts.push(`Hosted by ${ctx.hostDisplayName}`);
    }
    const when = ctx.scheduledForUtc ? parseUtcDate(ctx.scheduledForUtc) : null;
    if (when && !Number.isNaN(when.getTime())) {
      parts.push(when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    }
    if (ctx.durationMinutes) {
      parts.push(`${ctx.durationMinutes} min`);
    }
    return parts.join(' · ');
  });
  readonly isLive = computed(() => this.context()?.status === 'Live');

  private token = '';
  private joined: GuestJoinByTokenResponse | null = null;
  private lastLobbyOptions: LobbyJoinOptions = { audio: true, video: true };
  /** La reunión terminó por el servidor (fase 'ended'): al cerrar la sala no se ofrece Rejoin. */
  private endedByServer = false;
  private destroyed = false;

  constructor() {
    // Sala de espera / dentro / fin los pinta la sala; aquí solo se detecta la salida a 'idle'.
    effect(() => {
      const phase = this.phase();
      if (this.state() !== 'room') {
        return;
      }
      untracked(() => {
        if (phase === 'ended') {
          this.endedByServer = true;
        } else if (phase === 'idle') {
          this.afterRoomClosed();
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.meeting.phase() !== 'idle') {
        void this.meeting.leave();
      }
      this.realtime.disconnect();
      this.mediaPolicy.unprime(); // si después entra el staff en esta misma pestaña, que lea SU política
      this.title.setTitle('Meeting');
    });
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token')?.trim() ?? '';
    if (!this.token) {
      this.state.set('invalid');
      return;
    }
    this.service.context(this.token).subscribe({
      next: ctx => this.applyContext(ctx),
      error: () => this.state.set('invalid'), // 404 uniforme (o cualquier fallo): nada que enumerar
    });
  }

  private applyContext(ctx: GuestMeetingContext): void {
    this.context.set(ctx);
    this.title.setTitle(`${ctx.meetingTitle || 'Meeting'} · Meeting`);
    if (ctx.mediaPolicy) {
      this.mediaPolicy.prime(ctx.mediaPolicy); // el lobby y la sala leen la política de aquí (sin JWT)
    }
    if (!ctx.guestsAllowed) {
      this.state.set('guests-off');
      return;
    }
    if (ctx.status === 'Ended') {
      this.state.set('ended');
      return;
    }
    this.displayName.set((ctx.inviteeName ?? '').trim());
    this.state.set('name');
  }

  // ---------- Nombre → lobby ----------

  continueToLobby(): void {
    if (!this.canContinue()) {
      return;
    }
    this.displayName.set(this.displayName().trim().slice(0, MAX_NAME_LENGTH));
    this.state.set('lobby');
  }

  backToName(): void {
    this.state.set('name');
  }

  // ---------- Lobby → join ----------

  /** El lobby decidió (mic/cámara): ticket → socket → `joinAsGuest`. El clic desbloquea el AudioContext. */
  async joinFromLobby(options: LobbyJoinOptions): Promise<void> {
    this.lastLobbyOptions = options;
    void this.speaker.primeAudioContext();
    await this.connectAndJoin(true);
  }

  /** "Rejoin": con el socket vivo reutiliza el ticket; si cayó, pide uno nuevo (el token lo permite mientras siga en gracia). */
  async rejoin(): Promise<void> {
    await this.connectAndJoin(!this.realtime.connected() || !this.joined);
  }

  /** "Try again" tras un fallo: vuelve al lobby para elegir dispositivos de nuevo. */
  retry(): void {
    this.failure.set(null);
    this.state.set('lobby');
  }

  private async connectAndJoin(freshTicket: boolean): Promise<void> {
    const ctx = this.context();
    if (!ctx) {
      return;
    }
    this.state.set('connecting');
    this.failure.set(null);
    this.endedByServer = false;
    try {
      if (freshTicket) {
        this.joined = await firstValueFrom(this.service.joinByToken(this.token, this.displayName()));
        if (this.destroyed) {
          return;
        }
        await this.realtime.connectAsGuest(this.joined.shortLivedJoinTicket);
      }
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      this.state.set(this.stateForJoinError(err));
      return;
    }
    if (this.destroyed || !this.joined) {
      return;
    }
    await this.meeting.joinAsGuest(this.joined.meetingId, ctx.meetingTitle, this.joined.invitationId, this.lastLobbyOptions);
    if (this.destroyed) {
      return;
    }
    if (this.meeting.phase() === 'idle') {
      // El join falló (snapshot/ack): el servicio ya dejó el motivo en `errorMessage`.
      this.failure.set(this.meeting.errorMessage() ?? 'Could not join the meeting.');
      this.state.set('failed');
      return;
    }
    this.state.set('room');
  }

  /** 404 uniforme → enlace no válido; 403 GuestsNotAllowed → oficina sin invitados; resto → reintentable. */
  private stateForJoinError(err: unknown): GuestPageState {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return 'invalid';
      }
      if (err.status === 403 && toApiError(err).code === GUESTS_NOT_ALLOWED_CODE) {
        return 'guests-off';
      }
      this.failure.set(toApiError(err).message);
      return 'failed';
    }
    this.failure.set(err instanceof Error && err.message ? err.message : 'Could not connect to the meeting.');
    return 'failed';
  }

  // ---------- Salida de la sala ----------

  /** La sala emitió `left` (Leave, o Close en la pantalla de fin). La fase ya es 'idle' o lo será enseguida. */
  onLeft(): void {
    if (this.state() === 'room' && this.meeting.phase() === 'idle') {
      this.afterRoomClosed();
    }
  }

  private afterRoomClosed(): void {
    if (this.state() !== 'room') {
      return;
    }
    const reason = this.meeting.removedReason();
    if (reason === 'Revoked') {
      this.state.set('revoked');
      return;
    }
    if (this.endedByServer || reason === 'MeetingEnded') {
      this.state.set('ended');
      return;
    }
    this.state.set('left');
  }
}
