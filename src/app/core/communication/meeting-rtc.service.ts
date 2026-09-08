import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { types as MsTypes } from 'mediasoup-client';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SocketAck } from '@core/realtime/realtime.model';
import { SfuNewProducerDto, SfuProducerClosedDto, SfuRemoteProducer } from './meeting.model';

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
  MeetingJoinAck,
  MeetingJoinOptions,
  MeetingParticipantChangedDto,
  MeetingParticipantDeniedDto,
  MeetingRecordingConsentRecordedDto,
  MeetingRecordingConsentRequestedDto,
  MeetingRecordingStateChangedDto,
  MeetingSignalDto,
  MeetingSnapshotDto,
  MeetingStateDto,
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

  join(meetingId: string, opts?: MeetingJoinOptions): Promise<MeetingJoinAck> {
    return this.emitOrThrow('meeting.join', { clientKey: this.realtime.newClientKey(), meetingId, ...(opts ?? {}) });
  }

  /**
   * Re-une la room `m:{meetingId}` tras un reconnect transparente del socket, SIN re-pedir media ni
   * re-pasar por sala de espera (a diferencia de `join`). Devuelve el snapshot para reconciliar la
   * lista de participantes. Solo válido para un participante que sigue admitido.
   */
  rejoin(meetingId: string): Promise<{ snapshot: MeetingSnapshotDto }> {
    return this.emitOrThrow('meeting.rejoin', { meetingId });
  }

  leave(meetingId: string): Promise<unknown> {
    return this.emitOrThrow('meeting.leave', { meetingId });
  }

  // ---------- Señalización mesh / media (sin ack) ----------

  signal(meetingId: string, targetPeerUserId: string, kind: 'offer' | 'answer' | 'ice', data: Record<string, unknown>): void {
    this.realtime.emitNoAck('meeting.signal', { meetingId, targetPeerUserId, kind, data });
  }

  mediaStatus(meetingId: string, audioEnabled: boolean, videoEnabled: boolean, screenSharing: boolean): void {
    this.realtime.emitNoAck('meeting.media_status', { meetingId, audioEnabled, videoEnabled, screenSharing });
  }

  raiseHand(meetingId: string, raised: boolean): void {
    this.realtime.emitNoAck('meeting.raise_hand', { meetingId, raised });
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
  sfuProduce(meetingId: string, transportId: string, kind: MsTypes.MediaKind, rtpParameters: MsTypes.RtpParameters): Promise<{ producerId: string }> {
    return this.emitOrThrow('meeting.sfu.produce', { meetingId, transportId, kind, rtpParameters });
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

  // ---------- Eventos ----------

  onSignalFrom(): Observable<MeetingSignalDto> {
    return this.realtime.on<MeetingSignalDto>('meeting.signal.from');
  }
  /** El host me silenció (mute_all) → debo bajar mi audio. */
  onMutedByHost(): Observable<{ meetingId: string }> {
    return this.realtime.on<{ meetingId: string }>('meeting.you.muted');
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
  onTranscriptReady(): Observable<{ meetingId: string }> {
    return this.realtime.on<{ meetingId: string }>('meeting.transcript_ready');
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
  onParticipantDenied(): Observable<MeetingParticipantDeniedDto> {
    return this.realtime.on<MeetingParticipantDeniedDto>('meeting.participant.denied');
  }
  onCancelled(): Observable<MeetingCancelledDto> {
    return this.realtime.on<MeetingCancelledDto>('meeting.cancelled');
  }

  private async emitOrThrow<T>(event: string, payload: object): Promise<T> {
    const ack = (await this.realtime.emitAck<T>(event, payload)) as SocketAck<T>;
    if (!ack.ok) {
      throw new Error(ack.message || ack.code);
    }
    return ack.value;
  }
}
