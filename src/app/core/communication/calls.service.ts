import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { SocketAck, USER_PROFILE_CHANGED_EVENT, UserProfileChangedEvent } from '@core/realtime/realtime.model';
import { ConnectionQuality } from './media/media-policy.model';
import { QualityMetrics } from './media/derive-quality';
import type { types as MsTypes } from 'mediasoup-client';
import {
  CallCaptureRequestedDto,
  CallCaptureStoppedDto,
  CallDurationWarningDto,
  CallKind,
  CallMediaStatusDto,
  CallPeerQualityChangedDto,
  CallPeerDto,
  CallRecordingConsentRecordedDto,
  CallRecordingConsentRequestedDto,
  CallRecordingLimitWarningDto,
  CallRecordingStateChangedDto,
  CallSfuTransportParams,
  CallSignalDto,
  CallStateDto,
  CallTranscriptReadyDto,
  CallUpgradedToVideoDto,
  CustomerCallsResponse,
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

  /** F7 — desfase servidor−cliente (ms) para el reloj de la grabación. */
  readonly serverOffsetMs = this.realtime.serverOffsetMs;
  /** Reconexión del socket compartido: la llamada en curso vuelve a su room (`rejoin`). */
  readonly reconnected$ = this.realtime.reconnected$;

  getIceServers(ttlSeconds = 300): Observable<IceResponse> {
    const params = new HttpParams().set('ttl', ttlSeconds);
    return this.http.get<IceResponse>(`${this.base}/webrtc/ice`, { params });
  }

  /** Historial de llamadas in-app de un cliente concreto (perfil → Activity → Call history). */
  getCustomerCalls(customerId: string): Observable<CustomerCallsResponse> {
    return this.http.get<CustomerCallsResponse>(`${this.base}/customers/${customerId}/calls`);
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

  /**
   * Vuelve a la room de la llamada tras reconectar el socket (el canal nuevo no hereda las rooms).
   * Devuelve el estado actual: si ya terminó, el llamador la cierra con ese estado.
   */
  rejoin(callId: string): Promise<{ state: CallStateDto }> {
    return this.emitOrThrow('call.rejoin', { callId });
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

  /** Reporta la calidad de conexión local, solo al cambiar de nivel (el server la persiste y avisa al par). Sin ack. */
  connectionQuality(callId: string, quality: ConnectionQuality, metrics?: QualityMetrics | null): void {
    this.realtime.emitNoAck('call.connection_quality', {
      callId,
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
            },
          }
        : {}),
    });
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

  // ---------- F7 (D-56): captura de la grabación vía SFU (solo envío; la llamada sigue mesh) ----------

  /** Transport de envío contra el router `call:{callId}`. */
  sfuCreateTransport(callId: string): Promise<CallSfuTransportParams> {
    return this.emitOrThrow('call.sfu.create_transport', { callId });
  }

  sfuConnectTransport(callId: string, transportId: string, dtlsParameters: MsTypes.DtlsParameters): Promise<unknown> {
    return this.emitOrThrow('call.sfu.connect_transport', { callId, transportId, dtlsParameters });
  }

  sfuProduce(
    callId: string,
    transportId: string,
    kind: MsTypes.MediaKind,
    rtpParameters: MsTypes.RtpParameters,
    source: 'camera' | 'screen' = 'camera',
  ): Promise<{ producerId: string }> {
    return this.emitOrThrow('call.sfu.produce', { callId, transportId, kind, rtpParameters, source });
  }

  // ---------- Eventos ----------

  onIncoming(): Observable<IncomingCallDto> {
    return this.realtime.on<IncomingCallDto>('call.incoming');
  }
  onStateChanged(): Observable<CallStateDto> {
    return this.realtime.on<CallStateDto>('call.state_changed');
  }
  /** Un miembro del staff cambió su foto o nombre (refresca al par de la llamada en vivo). */
  onUserProfileChanged(): Observable<UserProfileChangedEvent> {
    return this.realtime.on<UserProfileChangedEvent>(USER_PROFILE_CHANGED_EVENT);
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
  /** F4 — calidad del PAR (badge de "su" conexión). */
  onPeerQualityChanged(): Observable<CallPeerQualityChangedDto> {
    return this.realtime.on<CallPeerQualityChangedDto>('call.peer_quality_changed');
  }
  /** F4 — aviso de tope de minutos (el corte lo hace el servidor con `endReason: 'MaxDurationReached'`). */
  onDurationWarning(): Observable<CallDurationWarningDto> {
    return this.realtime.on<CallDurationWarningDto>('call.duration.warning');
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
  /** F7 — aviso de tope de la grabación; al llegar al tope el servidor la para (la llamada sigue). */
  onRecordingLimitWarning(): Observable<CallRecordingLimitWarningDto> {
    return this.realtime.on<CallRecordingLimitWarningDto>('call.recording.limit_warning');
  }
  /** F7 (D-56) — el servidor pide publicar mi media al SFU de grabación. */
  onCaptureRequested(): Observable<CallCaptureRequestedDto> {
    return this.realtime.on<CallCaptureRequestedDto>('call.recording.capture_requested');
  }
  /** F7 (D-56) — fin de la captura: cerrar el transport. */
  onCaptureStopped(): Observable<CallCaptureStoppedDto> {
    return this.realtime.on<CallCaptureStoppedDto>('call.recording.capture_stopped');
  }

  /** emitAck no lanza (devuelve SocketAck); acá convertimos el fallo en excepción para el try/catch del state machine. */
  private async emitOrThrow<T>(event: string, payload: object): Promise<T> {
    const ack = (await this.realtime.emitAck<T>(event, payload)) as SocketAck<T>;
    if (!ack.ok) {
      // Se conserva el `code` (igual que MeetingRtcService) para distinguir p.ej. Call.RateLimited.
      const err = new Error(ack.message || ack.code) as Error & { code?: string };
      err.code = ack.code;
      throw err;
    }
    return ack.value;
  }
}
