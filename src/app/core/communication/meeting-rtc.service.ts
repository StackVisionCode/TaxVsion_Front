import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { types as MsTypes } from 'mediasoup-client';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SocketAck, USER_PROFILE_CHANGED_EVENT, UserProfileChangedEvent } from '@core/realtime/realtime.model';
import { SfuNewProducerDto, SfuProducerClosedDto, SfuRemoteProducer } from './meeting.model';
import { ConnectionQuality } from './media/media-policy.model';
import { QualityMetrics } from './media/derive-quality';

/** Parámetros de transporte SFU que devuelve create_transport (mediasoup + iceServers cliente). */
export interface SfuTransportParams {
  id: string;
  iceParameters: MsTypes.IceParameters;
  iceCandidates: MsTypes.IceCandidate[];
  dtlsParameters: MsTypes.DtlsParameters;
  iceServers: RTCIceServer[];
}

export interface SfuConsumerParams {
  id: string;
  producerId: string;
  kind: MsTypes.MediaKind;
  rtpParameters: MsTypes.RtpParameters;
}
import {
  MeetingCancelledDto,
  MeetingChatMessageDto,
  MeetingDurationWarningDto,
  MeetingEndedDto,
  MeetingHandLoweredByHostDto,
  MeetingHostChangedDto,
  MeetingJoinAck,
  MeetingJoinOptions,
  MeetingParticipantChangedDto,
  MeetingParticipantDeniedDto,
  MeetingParticipantDto,
  MeetingParticipantQualityChangedDto,
  MeetingRaiseHandAck,
  MeetingReactionReceivedDto,
  MeetingRecordingConsentRecordedDto,
  MeetingRecordingConsentRequestedDto,
  MeetingRecordingLimitWarningDto,
  MeetingRecordingStateChangedDto,
  MeetingRejoinAck,
  MeetingSignalDto,
  MeetingSnapshotDto,
  MeetingStateDto,
  MeetingTranscriptReadyDto,
  MeetingYouRemovedDto,
} from './meeting.model';

/**
 * Transporte socket de meetings sobre el socket ÚNICO de Communication (Fase 0).
 * Nombres/payloads espejo de `meeting-socket-events.ts`. 3A cubre join/leave + los
 * eventos de sala de espera/estado; la señalización mesh (signal/media/raiseHand) y
 * las host actions se agregan en 3B/3C.
 */
@Injectable({ providedIn: 'root' })
export class MeetingRtcService {
  private readonly realtime = inject(CommunicationRealtimeService);

  /** Reconexión del socket compartido (churn del tunnel). El servicio de meeting re-une la room. */
  readonly reconnected$ = this.realtime.reconnected$;
  /** F3 — desfase servidor−cliente (ms) para el reloj de la reunión (T-41). */
  readonly serverOffsetMs = this.realtime.serverOffsetMs;

  join(meetingId: string, opts?: MeetingJoinOptions): Promise<MeetingJoinAck> {
    return this.emitOrThrow('meeting.join', { clientKey: this.realtime.newClientKey(), meetingId, ...(opts ?? {}) });
  }

  /**
   * Re-une la room `m:{meetingId}` tras un reconnect transparente del socket, SIN re-pedir media ni
   * re-pasar por sala de espera (a diferencia de `join`). Devuelve el snapshot para reconciliar la
   * lista de participantes. Solo válido para un participante que sigue admitido.
   */
  rejoin(meetingId: string): Promise<MeetingRejoinAck> {
    return this.emitOrThrow('meeting.rejoin', { meetingId });
  }

  leave(meetingId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.leave', { meetingId });
  }

  /** F3 — `meeting.leave` fire-and-forget para `pagehide`/`beforeunload` (no hay tiempo de esperar el ack). */
  leaveNoAck(meetingId: string): void {
    this.realtime.emitNoAck('meeting.leave', { meetingId });
  }

  // ---------- Señalización mesh / media (sin ack) ----------

  signal(meetingId: string, targetPeerUserId: string, kind: 'offer' | 'answer' | 'ice', data: Record<string, unknown>): void {
    this.realtime.emitNoAck('meeting.signal', { meetingId, targetPeerUserId, kind, data });
  }

  mediaStatus(meetingId: string, audioEnabled: boolean, videoEnabled: boolean, screenSharing: boolean): void {
    this.realtime.emitNoAck('meeting.media_status', { meetingId, audioEnabled, videoEnabled, screenSharing });
  }

  /** F5 (D-49) — mano con ack: el servidor fija `handRaisedAtUtc` y lo devuelve (rollback si falla). */
  raiseHand(meetingId: string, raised: boolean): Promise<MeetingRaiseHandAck> {
    return this.emitOrThrow('meeting.raise_hand', { meetingId, raised });
  }

  /** F5 (T-69) — mi estado de habla por RMS local (sin ack; el servidor solo lo registra en la timeline). */
  speaking(meetingId: string, speaking: boolean): void {
    this.realtime.emitNoAck('meeting.speaking', { meetingId, speaking });
  }

  /** F5 (D-50) — reacción efímera con ack (`Meeting.ReactionsDisabled` / `ReactionNotInCatalog` / `ReactionRateLimited`). */
  react(meetingId: string, emoji: string): Promise<unknown> {
    return this.emitOrThrow('meeting.reaction', { meetingId, emoji });
  }

  /** F4 — calidad de conexión propia, SOLO al cambiar de nivel (el server la reparte a la room). Sin ack. */
  connectionQuality(meetingId: string, quality: ConnectionQuality, metrics?: QualityMetrics | null): void {
    this.realtime.emitNoAck('meeting.connection_quality', {
      meetingId,
      quality,
      ...(metrics
        ? {
            metrics: {
              rttMs: metrics.rttMs,
              lossPct: metrics.lossPct,
              jitterMs: metrics.jitterMs,
              viaRelay: metrics.viaRelay,
              inKbps: metrics.inKbps,
              outKbps: metrics.outKbps,
              fps: metrics.fps,
              layer: metrics.layer,
            },
          }
        : {}),
    });
  }

  /** Chat del meeting — reusa el motor de chat (Conversation kind Meeting), autoriza por "estás Joined". */
  chatSend(meetingId: string, body: string): Promise<unknown> {
    return this.emitOrThrow('meeting.chat.send', { clientKey: this.realtime.newClientKey(), meetingId, body });
  }

  // ---------- Grabación (con consentimiento) ----------

  requestRecording(meetingId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.recording.start_request', { clientKey: this.realtime.newClientKey(), meetingId });
  }
  respondRecordingConsent(meetingId: string, response: 'Accepted' | 'Rejected'): Promise<unknown> {
    return this.emitOrThrow('meeting.consent.respond', { meetingId, response });
  }
  stopRecording(meetingId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.recording.stop', { clientKey: this.realtime.newClientKey(), meetingId });
  }
  attachRecording(meetingId: string, fileId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.recording.attach', { clientKey: this.realtime.newClientKey(), meetingId, fileId });
  }

  // ---------- SFU (mediasoup, >4 participantes) ----------

  sfuGetRouterCapabilities(meetingId: string): Promise<MsTypes.RtpCapabilities> {
    return this.emitOrThrow('meeting.sfu.get_router_capabilities', { meetingId });
  }
  sfuCreateTransport(meetingId: string, direction: 'send' | 'recv'): Promise<SfuTransportParams> {
    return this.emitOrThrow('meeting.sfu.create_transport', { meetingId, direction });
  }
  sfuConnectTransport(meetingId: string, transportId: string, dtlsParameters: MsTypes.DtlsParameters): Promise<unknown> {
    return this.emitOrThrow('meeting.sfu.connect_transport', { meetingId, transportId, dtlsParameters });
  }
  sfuProduce(meetingId: string, transportId: string, kind: MsTypes.MediaKind, rtpParameters: MsTypes.RtpParameters, source: 'camera' | 'screen' = 'camera'): Promise<{ producerId: string }> {
    return this.emitOrThrow('meeting.sfu.produce', { meetingId, transportId, kind, rtpParameters, source });
  }
  sfuConsume(meetingId: string, transportId: string, producerId: string, rtpCapabilities: MsTypes.RtpCapabilities): Promise<SfuConsumerParams> {
    return this.emitOrThrow('meeting.sfu.consume', { meetingId, transportId, producerId, rtpCapabilities });
  }
  sfuResumeConsumer(meetingId: string, consumerId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.sfu.resume_consumer', { meetingId, consumerId });
  }
  sfuSetPreferredLayers(meetingId: string, consumerId: string, spatialLayer: number, temporalLayer?: number): Promise<unknown> {
    return this.emitOrThrow('meeting.sfu.set_preferred_layers', { meetingId, consumerId, spatialLayer, temporalLayer });
  }
  sfuListRemoteProducers(meetingId: string): Promise<SfuRemoteProducer[]> {
    return this.emitOrThrow('meeting.sfu.list_remote_producers', { meetingId });
  }
  /** ICE restart del transport en el servidor; los iceParameters nuevos se aplican con `transport.restartIce`. */
  sfuRestartIce(meetingId: string, transportId: string): Promise<{ iceParameters: MsTypes.IceParameters }> {
    return this.emitOrThrow('meeting.sfu.restart_ice', { meetingId, transportId });
  }
  onSfuNewProducer(): Observable<SfuNewProducerDto> {
    return this.realtime.on<SfuNewProducerDto>('meeting.sfu.new_producer');
  }
  onSfuProducerClosed(): Observable<SfuProducerClosedDto> {
    return this.realtime.on<SfuProducerClosedDto>('meeting.sfu.producer_closed');
  }

  // ---------- Host actions (con ack; el backend valida Host/Cohost) ----------

  admit(meetingId: string, targetUserId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.admit', { meetingId, targetUserId });
  }
  deny(meetingId: string, targetUserId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.deny_participant', { meetingId, targetUserId });
  }
  remove(meetingId: string, targetUserId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.remove', { meetingId, targetUserId });
  }
  lock(meetingId: string, locked: boolean): Promise<unknown> {
    return this.emitOrThrow('meeting.host.lock', { meetingId, locked });
  }
  muteAll(meetingId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.mute_all', { meetingId });
  }
  transferHost(meetingId: string, newHostUserId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.transfer', { meetingId, newHostUserId });
  }
  promoteCohost(meetingId: string, targetUserId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.promote_cohost', { meetingId, targetUserId });
  }
  demoteCohost(meetingId: string, targetUserId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.host.demote_cohost', { meetingId, targetUserId });
  }
  /** F5 — baja la mano de un participante (host/cohost). */
  lowerHand(meetingId: string, targetUserId: string): Promise<{ participant: MeetingParticipantDto }> {
    return this.emitOrThrow('meeting.host.lower_hand', { meetingId, targetUserId });
  }
  /** F5 — baja todas las manos; el ack dice cuántas. */
  lowerAllHands(meetingId: string): Promise<{ lowered: number }> {
    return this.emitOrThrow('meeting.host.lower_all_hands', { meetingId });
  }

  // ---------- Eventos ----------

  onSignalFrom(): Observable<MeetingSignalDto> {
    return this.realtime.on<MeetingSignalDto>('meeting.signal.from');
  }
  /** El host me silenció (mute_all) → debo bajar mi audio. */
  onMutedByHost(): Observable<{ meetingId: string }> {
    return this.realtime.on<{ meetingId: string }>('meeting.you.muted');
  }
  /** Un miembro del staff cambió su foto o nombre (actualiza el roster en vivo). */
  onUserProfileChanged(): Observable<UserProfileChangedEvent> {
    return this.realtime.on<UserProfileChangedEvent>(USER_PROFILE_CHANGED_EVENT);
  }
  onChatMessageNew(): Observable<MeetingChatMessageDto> {
    return this.realtime.on<MeetingChatMessageDto>('meeting.chat.message.new');
  }
  onRecordingConsentRequested(): Observable<MeetingRecordingConsentRequestedDto> {
    return this.realtime.on<MeetingRecordingConsentRequestedDto>('meeting.recording.consent_requested');
  }
  onRecordingConsentRecorded(): Observable<MeetingRecordingConsentRecordedDto> {
    return this.realtime.on<MeetingRecordingConsentRecordedDto>('meeting.recording.consent_recorded');
  }
  onRecordingStateChanged(): Observable<MeetingRecordingStateChangedDto> {
    return this.realtime.on<MeetingRecordingStateChangedDto>('meeting.recording.state_changed');
  }
  /** F7 — aviso de tope de la grabación (`remainingSeconds`); al llegar al tope el servidor la para. */
  onRecordingLimitWarning(): Observable<MeetingRecordingLimitWarningDto> {
    return this.realtime.on<MeetingRecordingLimitWarningDto>('meeting.recording.limit_warning');
  }
  onTranscriptReady(): Observable<MeetingTranscriptReadyDto> {
    return this.realtime.on<MeetingTranscriptReadyDto>('meeting.transcript_ready');
  }

  onSnapshot(): Observable<MeetingSnapshotDto> {
    return this.realtime.on<MeetingSnapshotDto>('meeting.snapshot');
  }
  onParticipantChanged(): Observable<MeetingParticipantChangedDto> {
    return this.realtime.on<MeetingParticipantChangedDto>('meeting.participant.changed');
  }
  onStateChanged(): Observable<MeetingStateDto> {
    return this.realtime.on<MeetingStateDto>('meeting.state.changed');
  }
  /** F4 — calidad de conexión de un participante (la UI pinta el badge; "Fair" se muestra como Unstable). */
  onParticipantQualityChanged(): Observable<MeetingParticipantQualityChangedDto> {
    return this.realtime.on<MeetingParticipantQualityChangedDto>('meeting.participant.quality_changed');
  }
  /** F5 — el host me bajó la mano (una o todas). */
  onHandLoweredByHost(): Observable<MeetingHandLoweredByHostDto> {
    return this.realtime.on<MeetingHandLoweredByHostDto>('meeting.hand.lowered_by_host');
  }
  /** F5 — reacción de alguien en la sala (volátil: si estoy reconectando se pierde). */
  onReactionReceived(): Observable<MeetingReactionReceivedDto> {
    return this.realtime.on<MeetingReactionReceivedDto>('meeting.reaction.received');
  }
  onParticipantDenied(): Observable<MeetingParticipantDeniedDto> {
    return this.realtime.on<MeetingParticipantDeniedDto>('meeting.participant.denied');
  }
  onCancelled(): Observable<MeetingCancelledDto> {
    return this.realtime.on<MeetingCancelledDto>('meeting.cancelled');
  }

  // ---------- F3: ciclo de vida, host y sesión ----------

  /** Aviso de tiempo restante (600/300/60 s), una vez por umbral. */
  onDurationWarning(): Observable<MeetingDurationWarningDto> {
    return this.realtime.on<MeetingDurationWarningDto>('meeting.duration.warning');
  }
  /** Cambió el host (transfer / sucesión / offboarding). */
  onHostChanged(): Observable<MeetingHostChangedDto> {
    return this.realtime.on<MeetingHostChangedDto>('meeting.host.changed');
  }
  /** El servidor sacó a ESTE socket de la sala. */
  onYouRemoved(): Observable<MeetingYouRemovedDto> {
    return this.realtime.on<MeetingYouRemovedDto>('meeting.you.removed');
  }
  /** Terminó (room de usuario; también le sirve a la sala si el `state.changed` no llegó). */
  onEnded(): Observable<MeetingEndedDto> {
    return this.realtime.on<MeetingEndedDto>('meeting.ended');
  }

  private async emitOrThrow<T>(event: string, payload: object): Promise<T> {
    const ack = (await this.realtime.emitAck<T>(event, payload)) as SocketAck<T>;
    if (!ack.ok) {
      // Se conserva el `code` para que el llamante distinga casos (p.ej. Meeting.InvalidPasscode → pedir passcode).
      const err = new Error(ack.message || ack.code) as Error & { code?: string };
      err.code = ack.code;
      throw err;
    }
    return ack.value;
  }
}
