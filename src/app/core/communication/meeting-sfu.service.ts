import { Injectable, inject } from '@angular/core';
// Solo tipos: la librería (~700 KB) se descarga en `join()`, no con la lista de reuniones.
import type { Device, types as MsTypes } from 'mediasoup-client';
import { Subscription } from 'rxjs';
import { MeetingRtcService } from './meeting-rtc.service';
import { DEFAULT_ICE_RECOVERY_POLICY, IceRecoveryPolicy, MediaLinkState, aggregateMediaState, decideIceRecovery } from './ice-recovery-policy';
import { MediaPolicyDto } from './media/media-policy.model';
import { SESSION_PRODUCER_OPTIONS } from './media/session-producer-options';

export type SfuSource = 'camera' | 'screen';
/** Mis producers: audio del micro, cámara, pantalla y audio de pantalla (D-41). */
export type SfuProducerKey = 'audio' | 'camera' | 'screen' | 'screen-audio';

/** Pistas locales iniciales (de `LocalMediaSession`). */
export interface SfuLocalTracks {
  audio: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  screenAudio: MediaStreamTrack | null;
}

/** Callbacks hacia ActiveMeetingService para poblar la grilla (sin acoplar el estado). */
export interface SfuHandlers {
  onRemoteStream(userId: string, source: SfuSource, stream: MediaStream): void;
  onRemovePeer(userId: string): void;
  /** Estado agregado de los dos transports (send/recv): ok, reconectando (ICE restart) o caído. */
  onMediaState?(state: MediaLinkState): void;
}

/** Factores de simulcast de la cámara: ¼, ½ y completa (capas 0/1/2). El bitrate escala igual. */
const CAMERA_SCALE_FACTORS = [4, 2, 1] as const;
const BITS_PER_KBIT = 1000;
const TOP_SPATIAL_LAYER = CAMERA_SCALE_FACTORS.length - 1;

export interface VideoProduceOptions {
  encodings: RTCRtpEncodingParameters[];
  codecOptions: { videoGoogleStartBitrate: number };
}

/**
 * Encodings del producer de video según la fuente y la política (sin números hard-coded):
 *  - cámara: 3 capas (`scaleResolutionDownBy` 4/2/1); la alta = `camera.maxBitrateKbps`, ½ y ¼ proporcionales;
 *  - pantalla: 1 capa a `screen.bitrateKbps`, o 2 (½ y completa) si `highBitrateKbps` es mayor.
 */
export function videoProduceOptions(source: SfuSource, policy: MediaPolicyDto): VideoProduceOptions {
  if (source === 'screen') {
    const screen = policy.video.screen;
    const encodings: RTCRtpEncodingParameters[] =
      screen.highBitrateKbps > screen.bitrateKbps
        ? [
            { rid: 'r0', maxBitrate: screen.bitrateKbps * BITS_PER_KBIT, scaleResolutionDownBy: 2 },
            { rid: 'r1', maxBitrate: screen.highBitrateKbps * BITS_PER_KBIT },
          ]
        : [{ rid: 'r0', maxBitrate: screen.bitrateKbps * BITS_PER_KBIT }];
    return { encodings, codecOptions: { videoGoogleStartBitrate: screen.bitrateKbps } };
  }
  const topKbps = policy.video.camera.maxBitrateKbps;
  const layerKbps = CAMERA_SCALE_FACTORS.map(scale => Math.round(topKbps / scale));
  const encodings: RTCRtpEncodingParameters[] = CAMERA_SCALE_FACTORS.map((scale, i) => ({
    rid: `r${i}`,
    maxBitrate: layerKbps[i] * BITS_PER_KBIT,
    ...(scale > 1 ? { scaleResolutionDownBy: scale } : {}),
  }));
  // Arranca en la capa media (kbps): ni a ciegas en la alta ni pegado abajo.
  return { encodings, codecOptions: { videoGoogleStartBitrate: layerKbps[1] } };
}

/** `codecOptions` de Opus del producer de audio: micro mono; audio de pantalla estéreo (D-41). */
export function audioProduceOptions(source: 'microphone' | 'screen', policy: MediaPolicyDto): MsTypes.ProducerCodecOptions {
  return {
    opusStereo: source === 'screen',
    opusDtx: policy.audio.opusDtx,
    opusFec: policy.audio.opusFec,
    opusMaxAverageBitrate: policy.audio.maxAverageBitrateKbps * BITS_PER_KBIT,
  };
}

/**
 * Cliente SFU (mediasoup-client) para meetings con `strategy === 'Sfu'` (>4 participantes).
 * Un solo send-transport (produce mis tracks) y un solo recv-transport (consume a todos).
 *
 * Dual-source: un participante produce cámara Y pantalla como producers separados etiquetados con
 * `source` (en `appData`, y al backend). El audio de pantalla es un producer de audio con
 * `source='screen'`. El receptor agrupa por `userId:source` en streams distintos.
 *
 * F1: cada transport se observa (`connectionstatechange`); ante `failed`/`disconnected` sostenido se
 * pide un ICE restart al servidor; agotados los reintentos se avisa `failed` para que la sala ofrezca
 * "Retry". F4: encodings/codecOptions salen de la política; modo solo audio (`setAudioOnly`) y capas
 * preferidas por fuente (`setPeerPreferredLayers`: la pantalla nunca se degrada).
 */
@Injectable({ providedIn: 'root' })
export class MeetingSfuService {
  private readonly rtc = inject(MeetingRtcService);
  private readonly recovery: IceRecoveryPolicy = DEFAULT_ICE_RECOVERY_POLICY;

  private device: Device | null = null;
  private sendTransport: MsTypes.Transport | null = null;
  private recvTransport: MsTypes.Transport | null = null;
  private readonly producers = new Map<SfuProducerKey, MsTypes.Producer>();
  private readonly consumers = new Map<string, MsTypes.Consumer>(); // por consumerId
  /** producerId → { userId, source, consumerId } — para cerrar el consumer correcto en producer_closed. */
  private readonly producerIndex = new Map<string, { userId: string; source: SfuSource; consumerId: string }>();
  /** Streams remotos por `userId:source` (cámara y pantalla separadas). */
  private readonly peerStreams = new Map<string, MediaStream>();
  /** Capa de cámara pedida por tile (para re-aplicarla cuando llega un consumer nuevo del mismo peer). */
  private readonly preferredCameraLayer = new Map<string, { spatial: number; temporal?: number }>();
  private readonly linkRestarts = new Map<string, number>();
  private readonly linkStates = new Map<string, MediaLinkState>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subs: Subscription[] = [];
  private meetingId: string | null = null;
  private handlers: SfuHandlers | null = null;
  private policy: MediaPolicyDto | null = null;
  private active = false;
  private audioOnly = false;
  private receiveLowLayers = false;

  private streamKey(userId: string, source: SfuSource): string {
    return `${userId}:${source}`;
  }

  /** Devuelve true si arrancó bien; false si falló (el caller degrada a `unsupported`). */
  async join(meetingId: string, local: SfuLocalTracks, handlers: SfuHandlers, policy: MediaPolicyDto): Promise<boolean> {
    if (this.active) {
      return true;
    }
    this.meetingId = meetingId;
    this.handlers = handlers;
    this.policy = policy;
    try {
      const routerRtpCapabilities = await this.rtc.sfuGetRouterCapabilities(meetingId);
      const { createMediasoupDevice } = await import('./media/mediasoup-device');
      this.device = createMediasoupDevice();
      await this.device.load({ routerRtpCapabilities });

      await this.createSendTransport();
      await this.createRecvTransport();
      await this.produceLocal(local);

      // Consumir a los que ya estaban, y suscribir altas/bajas de producers.
      const existing = await this.rtc.sfuListRemoteProducers(meetingId);
      for (const p of existing) {
        await this.consume(p.userId, p.producerId, p.source ?? 'camera');
      }
      this.subs.push(
        this.rtc.onSfuNewProducer().subscribe(dto => {
          if (dto.meetingId === this.meetingId) {
            void this.consume(dto.userId, dto.producerId, dto.source ?? 'camera');
          }
        }),
        this.rtc.onSfuProducerClosed().subscribe(dto => {
          if (dto.meetingId === this.meetingId) {
            this.closeRemoteProducer(dto.producerId);
          }
        }),
      );
      this.active = true;
      return true;
    } catch (err) {
      console.error('[MeetingSfu] join failed:', err);
      this.leave();
      return false;
    }
  }

  private async createSendTransport(): Promise<void> {
    const params = await this.rtc.sfuCreateTransport(this.meetingId!, 'send');
    const transport = this.device!.createSendTransport({
      id: params.id,
      iceParameters: params.iceParameters,
      iceCandidates: params.iceCandidates,
      dtlsParameters: params.dtlsParameters,
      iceServers: params.iceServers,
    });
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.rtc.sfuConnectTransport(this.meetingId!, transport.id, dtlsParameters).then(() => callback(), errback);
    });
    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      // El `source` (cámara/pantalla) viaja en appData → al backend para etiquetar el producer.
      const source = (appData as { source?: SfuSource }).source ?? 'camera';
      this.rtc
        .sfuProduce(this.meetingId!, transport.id, kind, rtpParameters, source)
        .then(({ producerId }) => callback({ id: producerId }), errback);
    });
    this.watchTransport(transport);
    this.sendTransport = transport;
  }

  private async createRecvTransport(): Promise<void> {
    const params = await this.rtc.sfuCreateTransport(this.meetingId!, 'recv');
    const transport = this.device!.createRecvTransport({
      id: params.id,
      iceParameters: params.iceParameters,
      iceCandidates: params.iceCandidates,
      dtlsParameters: params.dtlsParameters,
      iceServers: params.iceServers,
    });
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.rtc.sfuConnectTransport(this.meetingId!, transport.id, dtlsParameters).then(() => callback(), errback);
    });
    this.watchTransport(transport);
    this.recvTransport = transport;
  }

  // ---------- Recuperación ICE (F1) ----------

  private watchTransport(transport: MsTypes.Transport): void {
    this.linkStates.set(transport.id, 'ok');
    transport.on('connectionstatechange', state => this.handleTransportState(transport, state));
  }

  private handleTransportState(transport: MsTypes.Transport, state: string): void {
    this.clearGrace(transport.id);
    const restarts = this.linkRestarts.get(transport.id) ?? 0;
    switch (decideIceRecovery(state, restarts, this.recovery)) {
      case 'recovered':
        this.linkRestarts.set(transport.id, 0);
        this.setLinkState(transport.id, 'ok');
        break;
      case 'restart-now':
        void this.restartIce(transport);
        break;
      case 'restart-after-grace':
        this.setLinkState(transport.id, 'reconnecting');
        this.graceTimers.set(
          transport.id,
          setTimeout(() => {
            this.graceTimers.delete(transport.id);
            if (transport.connectionState === 'disconnected') {
              void this.restartIce(transport);
            }
          }, this.recovery.disconnectedGraceMs),
        );
        break;
      case 'give-up':
        this.setLinkState(transport.id, 'failed');
        break;
      default:
        break;
    }
  }

  /** Pide iceParameters nuevos al SFU y los aplica; si la señalización falla, el enlace queda caído. */
  private async restartIce(transport: MsTypes.Transport): Promise<void> {
    if (!this.meetingId || transport.closed) {
      return;
    }
    this.linkRestarts.set(transport.id, (this.linkRestarts.get(transport.id) ?? 0) + 1);
    this.setLinkState(transport.id, 'reconnecting');
    try {
      const { iceParameters } = await this.rtc.sfuRestartIce(this.meetingId, transport.id);
      await transport.restartIce({ iceParameters });
    } catch (err) {
      console.error('[MeetingSfu] restartIce failed:', err);
      this.setLinkState(transport.id, 'failed');
    }
  }

  private setLinkState(transportId: string, state: MediaLinkState): void {
    this.linkStates.set(transportId, state);
    this.handlers?.onMediaState?.(aggregateMediaState([...this.linkStates.values()]));
  }

  private clearGrace(transportId: string): void {
    const timer = this.graceTimers.get(transportId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(transportId);
    }
  }

  // ---------- Producers ----------

  private async produceLocal(local: SfuLocalTracks): Promise<void> {
    if (!this.sendTransport) {
      return;
    }
    if (local.audio) {
      await this.produce('audio', local.audio);
    }
    if (local.camera) {
      await this.produce('camera', local.camera);
    }
    if (local.screen) {
      await this.produce('screen', local.screen);
    }
    if (local.screenAudio) {
      await this.produce('screen-audio', local.screenAudio);
    }
  }

  private async produce(key: SfuProducerKey, track: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport || !this.device || !this.policy) {
      return;
    }
    const existing = this.producers.get(key);
    if (existing && !existing.closed) {
      await existing.replaceTrack({ track });
      return;
    }
    if (track.kind === 'video') {
      if (!this.device.canProduce('video')) {
        return;
      }
      const source: SfuSource = key === 'screen' ? 'screen' : 'camera';
      const producer = await this.sendTransport.produce({
        track,
        ...SESSION_PRODUCER_OPTIONS,
        ...videoProduceOptions(source, this.policy),
        appData: { source },
      });
      this.producers.set(key, producer);
      if (key === 'camera' && this.audioOnly) {
        producer.pause();
      }
      return;
    }
    const source = key === 'screen-audio' ? 'screen' : 'microphone';
    const producer = await this.sendTransport.produce({
      track,
      ...SESSION_PRODUCER_OPTIONS,
      codecOptions: audioProduceOptions(source, this.policy),
      appData: { source: source === 'screen' ? 'screen' : 'camera' },
    });
    this.producers.set(key, producer);
  }

  /** Cambia la pista de un producer sin renegociar; lo crea si no existía; `null` = dejar de enviar. */
  async replaceTrack(key: SfuProducerKey, track: MediaStreamTrack | null): Promise<void> {
    const producer = this.producers.get(key);
    if (producer && !producer.closed) {
      await producer.replaceTrack({ track });
      return;
    }
    if (track) {
      await this.produce(key, track);
    }
  }

  /** @deprecated alias de `replaceTrack` para la fuente de video. */
  replaceVideoTrack(source: SfuSource, track: MediaStreamTrack | null): Promise<void> {
    return this.replaceTrack(source, track);
  }

  /**
   * D-40 — modo solo audio: pausa el producer de cámara (el SFU deja de reenviar) y pide la capa
   * baja de las cámaras remotas. Al salir, se vuelve a producir y se restauran las capas pedidas.
   */
  async setAudioOnly(on: boolean): Promise<void> {
    this.audioOnly = on;
    const camera = this.producers.get('camera');
    if (camera && !camera.closed) {
      if (on) {
        camera.pause();
      } else {
        camera.resume();
      }
    }
    await this.setReceiveLowLayers(on);
  }

  /** Tope de capa espacial que ENVÍO (recuperación gradual: 1 = media, `TOP_SPATIAL_LAYER` = completa). */
  async setMaxSendSpatialLayer(spatial: number): Promise<void> {
    const camera = this.producers.get('camera');
    if (!camera || camera.closed) {
      return;
    }
    try {
      await camera.setMaxSpatialLayer(Math.max(0, Math.min(TOP_SPATIAL_LAYER, spatial)));
    } catch {
      /* el producer no es simulcast (p. ej. navegador sin soporte) */
    }
  }

  /** Pide la capa baja de TODAS las cámaras remotas (preferAudioOnly / red pobre); false restaura lo pedido por tile. */
  async setReceiveLowLayers(on: boolean): Promise<void> {
    this.receiveLowLayers = on;
    for (const [producerId, entry] of this.producerIndex) {
      if (entry.source !== 'camera' || this.consumers.get(entry.consumerId)?.kind !== 'video') {
        continue;
      }
      void producerId;
      await this.applyCameraLayer(entry.userId, entry.consumerId);
    }
  }

  // ---------- Consumers ----------

  private async consume(userId: string, producerId: string, source: SfuSource): Promise<void> {
    if (!this.recvTransport || !this.device || this.producerIndex.has(producerId)) {
      return; // ya consumido o sin transport
    }
    try {
      const params = await this.rtc.sfuConsume(this.meetingId!, this.recvTransport.id, producerId, this.device.rtpCapabilities);
      const consumer = await this.recvTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      this.consumers.set(consumer.id, consumer);
      this.producerIndex.set(producerId, { userId, source, consumerId: consumer.id });

      // El audio del micro va con la cámara (mismo tile de la persona); el audio de pantalla con la pantalla.
      const streamSource: SfuSource = source;
      const key = this.streamKey(userId, streamSource);
      let stream = this.peerStreams.get(key);
      const isNew = !stream;
      if (!stream) {
        stream = new MediaStream();
        this.peerStreams.set(key, stream);
      }
      stream.addTrack(consumer.track);
      if (isNew) {
        this.handlers?.onRemoteStream(userId, streamSource, stream);
      }
      await this.rtc.sfuResumeConsumer(this.meetingId!, consumer.id); // el consumer arranca en pausa
      if (consumer.kind === 'video' && source === 'camera') {
        await this.applyCameraLayer(userId, consumer.id);
      }
    } catch (err) {
      console.error('[MeetingSfu] consume failed:', err);
    }
  }

  /**
   * Capa de simulcast preferida del video de un peer POR FUENTE. Cámara: spotlight = alta, thumbnail
   * = baja. Pantalla: siempre la más alta (nunca se degrada por spotlight) → no-op. No-op en mesh.
   */
  async setPeerPreferredLayers(userId: string, source: SfuSource, spatialLayer: number, temporalLayer?: number): Promise<void> {
    if (source === 'screen') {
      return;
    }
    this.preferredCameraLayer.set(userId, { spatial: spatialLayer, temporal: temporalLayer });
    for (const [, entry] of this.producerIndex) {
      if (entry.userId === userId && entry.source === 'camera' && this.consumers.get(entry.consumerId)?.kind === 'video') {
        await this.applyCameraLayer(userId, entry.consumerId);
      }
    }
  }

  private async applyCameraLayer(userId: string, consumerId: string): Promise<void> {
    const wanted = this.preferredCameraLayer.get(userId);
    const spatial = this.receiveLowLayers ? 0 : (wanted?.spatial ?? TOP_SPATIAL_LAYER);
    try {
      await this.rtc.sfuSetPreferredLayers(this.meetingId!, consumerId, spatial, this.receiveLowLayers ? undefined : wanted?.temporal);
    } catch (err) {
      console.error('[MeetingSfu] setPreferredLayers failed:', err);
    }
  }

  private closeRemoteProducer(producerId: string): void {
    const entry = this.producerIndex.get(producerId);
    if (!entry) {
      return;
    }
    this.producerIndex.delete(producerId);
    const consumer = this.consumers.get(entry.consumerId);
    if (consumer) {
      const key = this.streamKey(entry.userId, entry.source);
      const stream = this.peerStreams.get(key);
      stream?.removeTrack(consumer.track);
      consumer.close();
      this.consumers.delete(entry.consumerId);
      if (stream && stream.getTracks().length === 0) {
        this.peerStreams.delete(key);
      }
    }
    // Sin NINGÚN producer (cámara/pantalla/audio) → salió del meeting. Si solo cerró la pantalla, el peer
    // se queda; el tile de pantalla se oculta por el flag `screenSharing` del roster.
    const hasAny = [...this.producerIndex.values()].some(e => e.userId === entry.userId);
    if (!hasAny) {
      this.preferredCameraLayer.delete(entry.userId);
      this.handlers?.onRemovePeer(entry.userId);
    }
  }

  // ---------- Diagnóstico (T-48) ----------

  /** Stats de los dos transports (cada uno es un RTCPeerConnection por debajo). */
  async collectStats(): Promise<RTCStatsReport[]> {
    const transports = [this.sendTransport, this.recvTransport].filter((t): t is MsTypes.Transport => !!t && !t.closed);
    const reports = await Promise.all(transports.map(t => t.getStats().catch(() => null)));
    return reports.filter((r): r is RTCStatsReport => !!r);
  }

  isConnected(): boolean {
    const transports = [this.sendTransport, this.recvTransport].filter((t): t is MsTypes.Transport => !!t);
    return transports.length > 0 && transports.every(t => t.connectionState === 'connected');
  }

  leave(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    this.graceTimers.forEach(t => clearTimeout(t));
    this.graceTimers.clear();
    this.linkRestarts.clear();
    this.linkStates.clear();
    this.producers.forEach(p => p.close());
    this.producers.clear();
    this.consumers.forEach(c => c.close());
    this.consumers.clear();
    this.producerIndex.clear();
    this.peerStreams.clear();
    this.preferredCameraLayer.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.meetingId = null;
    this.handlers = null;
    this.policy = null;
    this.active = false;
    this.audioOnly = false;
    this.receiveLowLayers = false;
  }
}
