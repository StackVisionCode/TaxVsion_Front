import { Injectable, inject } from '@angular/core';
import { Device, types as MsTypes } from 'mediasoup-client';
import { Subscription } from 'rxjs';
import { MeetingRtcService } from './meeting-rtc.service';

/** Callbacks hacia ActiveMeetingService para poblar la grilla (sin acoplar el estado). */
export interface SfuHandlers {
  onRemoteStream(userId: string, stream: MediaStream): void;
  onRemovePeer(userId: string): void;
}

/**
 * Cliente SFU (mediasoup-client) para meetings con `strategy === 'Sfu'` (>4 participantes).
 * Un solo send-transport (produce mis tracks) y un solo recv-transport (consume a todos).
 * Reemplaza el mesh (N peer connections) por 2 transports contra el SFU del backend.
 *
 * Flujo: get_router_capabilities → device.load → create/connect send+recv transport →
 * produce mis tracks → list_remote_producers + `sfu.new_producer` → consume → resume.
 * Limpieza en leave y ante `sfu.producer_closed`.
 */
@Injectable({ providedIn: 'root' })
export class MeetingSfuService {
  private readonly rtc = inject(MeetingRtcService);

  private device: Device | null = null;
  private sendTransport: MsTypes.Transport | null = null;
  private recvTransport: MsTypes.Transport | null = null;
  private readonly producers = new Map<string, MsTypes.Producer>(); // por kind
  private readonly consumers = new Map<string, MsTypes.Consumer>(); // por consumerId
  /** producerId → { userId, consumerId } — para cerrar el consumer correcto en producer_closed. */
  private readonly producerIndex = new Map<string, { userId: string; consumerId: string }>();
  private readonly peerStreams = new Map<string, MediaStream>();
  private subs: Subscription[] = [];
  private meetingId: string | null = null;
  private handlers: SfuHandlers | null = null;
  private active = false;

  /** Devuelve true si arrancó bien; false si falló (el caller degrada a `unsupported`). */
  async join(meetingId: string, localStream: MediaStream | null, handlers: SfuHandlers): Promise<boolean> {
    if (this.active) {
      return true;
    }
    this.meetingId = meetingId;
    this.handlers = handlers;
    try {
      const routerRtpCapabilities = await this.rtc.sfuGetRouterCapabilities(meetingId);
      this.device = new Device();
      await this.device.load({ routerRtpCapabilities });

      await this.createSendTransport();
      await this.createRecvTransport();
      await this.produceLocal(localStream);

      // Consumir a los que ya estaban, y suscribir altas/bajas de producers.
      const existing = await this.rtc.sfuListRemoteProducers(meetingId);
      for (const p of existing) {
        await this.consume(p.userId, p.producerId);
      }
      this.subs.push(
        this.rtc.onSfuNewProducer().subscribe(dto => {
          if (dto.meetingId === this.meetingId) {
            void this.consume(dto.userId, dto.producerId);
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
    transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      this.rtc
        .sfuProduce(this.meetingId!, transport.id, kind, rtpParameters)
        .then(({ producerId }) => callback({ id: producerId }), errback);
    });
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
    this.recvTransport = transport;
  }

  /**
   * Simulcast del video (VP8, ver mediasoup-config): 3 capas espaciales (¼, ½, full). mediasoup elige
   * por consumidor la capa más alta que quepa en su ancho de banda estimado → el SFU DEGRADA solo bajo
   * congestión. Sin esto se producía UNA sola capa y no había nada que bajar ("SFU no degrada").
   */
  private videoProduceOptions(): { encodings: RTCRtpEncodingParameters[]; codecOptions: { videoGoogleStartBitrate: number } } {
    return {
      encodings: [
        { rid: 'r0', maxBitrate: 150_000, scaleResolutionDownBy: 4 },
        { rid: 'r1', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
        { rid: 'r2', maxBitrate: 1_200_000 },
      ],
      codecOptions: { videoGoogleStartBitrate: 1000 },
    };
  }

  private async produceLocal(localStream: MediaStream | null): Promise<void> {
    if (!this.sendTransport || !localStream) {
      return;
    }
    for (const track of localStream.getTracks()) {
      if (track.kind === 'video' && !this.device!.canProduce('video')) {
        continue;
      }
      const producer = await this.sendTransport.produce(
        track.kind === 'video' ? { track, ...this.videoProduceOptions() } : { track },
      );
      this.producers.set(track.kind, producer);
    }
  }

  private async consume(userId: string, producerId: string): Promise<void> {
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
      this.producerIndex.set(producerId, { userId, consumerId: consumer.id });

      let stream = this.peerStreams.get(userId);
      const isNew = !stream;
      if (!stream) {
        stream = new MediaStream();
        this.peerStreams.set(userId, stream);
      }
      stream.addTrack(consumer.track);
      if (isNew) {
        this.handlers?.onRemoteStream(userId, stream);
      }
      await this.rtc.sfuResumeConsumer(this.meetingId!, consumer.id); // el consumer arranca en pausa
    } catch (err) {
      console.error('[MeetingSfu] consume failed:', err);
    }
  }

  /**
   * Fija la capa de simulcast preferida del video de un peer (spotlight = alta, thumbnail = baja).
   * Resuelve el consumerId de VIDEO de ese userId (no hay mapa directo userId→consumerId). No-op en mesh
   * (producerIndex vacío) o si el peer aún no tiene consumer de video.
   */
  async setPeerPreferredLayers(userId: string, spatialLayer: number, temporalLayer?: number): Promise<void> {
    for (const { userId: u, consumerId } of this.producerIndex.values()) {
      if (u !== userId) {
        continue;
      }
      if (this.consumers.get(consumerId)?.kind !== 'video') {
        continue;
      }
      try {
        await this.rtc.sfuSetPreferredLayers(this.meetingId!, consumerId, spatialLayer, temporalLayer);
      } catch (err) {
        console.error('[MeetingSfu] setPreferredLayers failed:', err);
      }
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
      const stream = this.peerStreams.get(entry.userId);
      stream?.removeTrack(consumer.track);
      consumer.close();
      this.consumers.delete(entry.consumerId);
      // Si al usuario no le queda ningún track, sacarlo de la grilla.
      if (stream && stream.getTracks().length === 0) {
        this.peerStreams.delete(entry.userId);
        this.handlers?.onRemovePeer(entry.userId);
      }
    }
  }

  /** Cambia el track de video que produzco (cámara ↔ pantalla) sin renegociar. */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    const producer = this.producers.get('video');
    if (producer && !producer.closed) {
      await producer.replaceTrack({ track });
      return;
    }
    // No había producer de video (entré con la cámara apagada): crear uno con la pantalla.
    if (track && this.sendTransport && this.device?.canProduce('video')) {
      const newProducer = await this.sendTransport.produce({ track, ...this.videoProduceOptions() });
      this.producers.set('video', newProducer);
    }
  }

  leave(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    this.producers.forEach(p => p.close());
    this.producers.clear();
    this.consumers.forEach(c => c.close());
    this.consumers.clear();
    this.producerIndex.clear();
    this.peerStreams.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.meetingId = null;
    this.handlers = null;
    this.active = false;
  }
}
