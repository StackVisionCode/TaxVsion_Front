import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SocketAck } from '@core/realtime/realtime.model';
import {
  CallKind,
  CallMediaStatusDto,
  CallPeerDto,
  CallRecordingConsentRecordedDto,
  CallRecordingConsentRequestedDto,
  CallRecordingStateChangedDto,
  CallSignalDto,
  CallStateDto,
  CallTranscriptReadyDto,
  CallUpgradedToVideoDto,
  IceResponse,
  IncomingCallDto,
} from './call.model';

/**
 * Transporte de llamadas 1:1 sobre el socket ÚNICO de Communication
 * (`CommunicationRealtimeService`, Fase 0). Nombres de evento y payloads espejo de
 * `call-socket-events.ts` del backend. El server solo relaya SDP/ICE (opaco); el
 * RTCPeerConnection lo maneja ActiveCallService.
 */
@Injectable({ providedIn: 'root' })
export class CallsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly realtime = inject(CommunicationRealtimeService);
  private get base(): string {
    return this.api.tenantUrl('/communication');
  }

  getIceServers(ttlSeconds = 300): Observable<IceResponse> {
    const params = new HttpParams().set('ttl', ttlSeconds);
    return this.http.get<IceResponse>(`${this.base}/webrtc/ice`, { params });
  }

  // ---------- Comandos con ack ----------

  initiate(calleeUserId: string, kind: CallKind, conversationId?: string): Promise<{ callId: string; ringingAtUtc: string }> {
    return this.emitOrThrow('call.initiate', {
      clientKey: this.realtime.newClientKey(),
      calleeUserId,
      kind,
      ...(conversationId ? { conversationId } : {}),
    });
  }

  accept(callId: string): Promise<{ delivered?: boolean } | unknown> {
    return this.emitOrThrow('call.accept', { clientKey: this.realtime.newClientKey(), callId });
  }

  reject(callId: string): Promise<unknown> {
    return this.emitOrThrow('call.reject', { clientKey: this.realtime.newClientKey(), callId });
  }

  cancel(callId: string): Promise<unknown> {
    return this.emitOrThrow('call.cancel', { clientKey: this.realtime.newClientKey(), callId });
  }

  end(callId: string): Promise<unknown> {
    return this.emitOrThrow('call.end', { clientKey: this.realtime.newClientKey(), callId });
  }

  // ---------- Señalización / estado (sin ack) ----------

  /** Relay de SDP/ICE al peer — solo válido en Accepted/Active. */
  signal(callId: string, targetPeerUserId: string, kind: 'offer' | 'answer' | 'ice', data: Record<string, unknown>): void {
    this.realtime.emitNoAck('call.signal', { callId, targetPeerUserId, kind, data });
  }

  mediaStatus(callId: string, audioEnabled: boolean, videoEnabled: boolean, screenSharing: boolean): void {
    this.realtime.emitNoAck('call.media_status', { callId, audioEnabled, videoEnabled, screenSharing });
  }

  /** Reporta la calidad de conexión local (para el registro del backend). Sin ack. */
  connectionQuality(callId: string, quality: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Disconnected'): void {
    this.realtime.emitNoAck('call.connection_quality', { callId, quality });
  }

  /** Pasa una llamada de audio a video (el media se cambia con replaceTrack, sin renegociar). */
  upgradeToVideo(callId: string): Promise<{ callId: string; upgradedAtUtc: string }> {
    return this.emitOrThrow('call.upgrade_to_video', { clientKey: this.realtime.newClientKey(), callId });
  }

  startScreenShare(callId: string): Promise<{ callId: string; startedAtUtc: string }> {
    return this.emitOrThrow('call.screen_share.start', { clientKey: this.realtime.newClientKey(), callId });
  }

  stopScreenShare(callId: string): Promise<unknown> {
    return this.emitOrThrow('call.screen_share.stop', { clientKey: this.realtime.newClientKey(), callId });
  }

  // ---------- Grabación (con consentimiento) ----------

  /** Abre el ciclo de consentimiento (no arranca la grabación). Ack: participantes. */
  requestRecording(callId: string): Promise<{ callId: string; participantUserIds: string[]; requestedAtUtc: string }> {
    return this.emitOrThrow('call.recording.start_request', { clientKey: this.realtime.newClientKey(), callId });
  }

  /** Responde el consentimiento. Con AllAccepted (2 partes) ambos deben aceptar para arrancar. */
  respondRecordingConsent(callId: string, response: 'Accepted' | 'Rejected'): Promise<{ response: string }> {
    return this.emitOrThrow('call.consent.respond', { callId, response });
  }

  stopRecording(callId: string): Promise<{ callId: string; elapsedSeconds: number }> {
    return this.emitOrThrow('call.recording.stop', { clientKey: this.realtime.newClientKey(), callId });
  }

  /** El cliente ya subió el archivo a CloudStorage; adjunta el fileId a la grabación. */
  attachRecording(callId: string, fileId: string): Promise<{ callId: string; recordingFileId: string }> {
    return this.emitOrThrow('call.recording.attach', { clientKey: this.realtime.newClientKey(), callId, fileId });
  }

  // ---------- Eventos ----------

  onIncoming(): Observable<IncomingCallDto> {
    return this.realtime.on<IncomingCallDto>('call.incoming');
  }
  onStateChanged(): Observable<CallStateDto> {
    return this.realtime.on<CallStateDto>('call.state_changed');
  }
  onPeerJoined(): Observable<CallPeerDto> {
    return this.realtime.on<CallPeerDto>('call.peer_joined');
  }
  onSignalFrom(): Observable<CallSignalDto> {
    return this.realtime.on<CallSignalDto>('call.signal_from');
  }
  onMediaStatusChanged(): Observable<CallMediaStatusDto> {
    return this.realtime.on<CallMediaStatusDto>('call.media_status_changed');
  }
  onUpgradedToVideo(): Observable<CallUpgradedToVideoDto> {
    return this.realtime.on<CallUpgradedToVideoDto>('call.upgraded_to_video');
  }
  onRecordingConsentRequested(): Observable<CallRecordingConsentRequestedDto> {
    return this.realtime.on<CallRecordingConsentRequestedDto>('call.recording.consent_requested');
  }
  onRecordingConsentRecorded(): Observable<CallRecordingConsentRecordedDto> {
    return this.realtime.on<CallRecordingConsentRecordedDto>('call.recording.consent_recorded');
  }
  onRecordingStateChanged(): Observable<CallRecordingStateChangedDto> {
    return this.realtime.on<CallRecordingStateChangedDto>('call.recording.state_changed');
  }
  onTranscriptReady(): Observable<CallTranscriptReadyDto> {
    return this.realtime.on<CallTranscriptReadyDto>('call.transcript_ready');
  }

  /** emitAck no lanza (devuelve SocketAck); acá convertimos el fallo en excepción para el try/catch del state machine. */
  private async emitOrThrow<T>(event: string, payload: object): Promise<T> {
    const ack = (await this.realtime.emitAck<T>(event, payload)) as SocketAck<T>;
    if (!ack.ok) {
      throw new Error(ack.message || ack.code);
    }
    return ack.value;
  }
}
