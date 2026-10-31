import { Injectable } from '@angular/core';
import { DEFAULT_ICE_RECOVERY_POLICY, IceRecoveryPolicy, MediaLinkState, decideIceRecovery } from '../ice-recovery-policy';

export type PeerSignalKind = 'offer' | 'answer' | 'ice';
/** Fuentes de pista en un enlace mesh, en el ORDEN determinista de m-lines: audio, cámara, pantalla, audio de pantalla. */
export type PeerTrackSource = 'microphone' | 'camera' | 'screen' | 'screen-audio';

export interface OpusSdpOptions {
  fec: boolean;
  dtx: boolean;
  /** kbps; null = no fijar `maxaveragebitrate`. */
  maxAverageBitrateKbps: number | null;
}

export interface PeerLocalTracks {
  microphone: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  screenAudio: MediaStreamTrack | null;
  /** Stream de preview (micro + cámara) para `addTrack(track, stream)`. */
  stream: MediaStream | null;
  /** Stream de la pantalla (real o placeholder). */
  screenStream: MediaStream | null;
}

export interface PeerLinkOptions {
  iceServers: RTCIceServer[];
  /** Perfect negotiation: el polite cede en colisión de ofertas (getter: el servidor puede reasignarlo). */
  isPolite: () => boolean;
  /** ¿Este lado puede crear ofertas? (calls: solo el caller; meetings: ambos). */
  canOffer: () => boolean;
  local: PeerLocalTracks;
  /** Opus FEC/DTX/bitrate en el SDP que se envía (lo que el par usará al codificar hacia mí). */
  opus: OpusSdpOptions | null;
  recovery?: IceRecoveryPolicy;
  signal(kind: PeerSignalKind, data: Record<string, unknown>): void;
  /** Llegó una pista remota (ya agregada a `remoteCameraStream`/`remoteScreenStream`). */
  onRemoteTrack?(source: 'camera' | 'screen', track: MediaStreamTrack): void;
  onConnected?(): void;
  onLinkState?(state: MediaLinkState): void;
  /** `connectionState === 'closed'` (el otro lado cerró). */
  onClosed?(): void;
}

/**
 * F4 — Un RTCPeerConnection gestionado: senders persistentes por fuente (replaceTrack sin
 * renegociar), perfect negotiation, recuperación ICE con `ice-recovery-policy`,
 * `degradationPreference` por sender y munging Opus. Lo crea `PeerConnectionFactory`.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  /** Cámara (+ micro) y pantalla (+ su audio) del par, clasificadas por m-line. */
  readonly remoteCameraStream = new MediaStream();
  readonly remoteScreenStream = new MediaStream();
  linkState: MediaLinkState = 'ok';
  private readonly senders = new Map<PeerTrackSource, RTCRtpSender>();
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private iceRestarts = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly recovery: IceRecoveryPolicy;

  constructor(private readonly opts: PeerLinkOptions) {
    this.recovery = opts.recovery ?? DEFAULT_ICE_RECOVERY_POLICY;
    const pc = new RTCPeerConnection({ iceServers: opts.iceServers });
    this.pc = pc;
    this.addLocalTracks(opts.local);

    pc.ontrack = event => {
      const screenSender = this.senders.get('screen');
      const screenAudioSender = this.senders.get('screen-audio');
      const sender = event.transceiver?.sender;
      const isScreen = !!sender && ((!!screenSender && sender === screenSender) || (!!screenAudioSender && sender === screenAudioSender));
      (isScreen ? this.remoteScreenStream : this.remoteCameraStream).addTrack(event.track);
      opts.onRemoteTrack?.(isScreen ? 'screen' : 'camera', event.track);
    };
    pc.onicecandidate = event => {
      if (event.candidate) {
        opts.signal('ice', event.candidate.toJSON() as unknown as Record<string, unknown>);
      }
    };
    pc.onnegotiationneeded = () => void this.negotiate();
    pc.oniceconnectionstatechange = () => this.handleLinkState();
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.applyDegradationPreferences();
        opts.onConnected?.();
      } else if (state === 'closed') {
        opts.onClosed?.();
      }
      this.handleLinkState();
    };
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  sender(source: PeerTrackSource): RTCRtpSender | null {
    return this.senders.get(source) ?? null;
  }

  /** Cambia la pista de una fuente sin renegociar (`null` = dejar de enviar). */
  async replaceTrack(source: PeerTrackSource, track: MediaStreamTrack | null): Promise<void> {
    const sender = this.senders.get(source);
    if (sender) {
      await sender.replaceTrack(track);
      this.applyDegradationPreference(source, sender);
    }
  }

  /** Stats crudas del enlace (para el monitor de calidad). */
  collectStats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  /** Señal entrante (offer/answer/ice) con perfect negotiation (patrón MDN). */
  async handleSignal(kind: PeerSignalKind, data: unknown): Promise<void> {
    const pc = this.pc;
    try {
      if (kind === 'offer' || kind === 'answer') {
        const description = data as RTCSessionDescriptionInit;
        const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
        const offerCollision = kind === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.opts.isPolite() && offerCollision;
        if (this.ignoreOffer) {
          return;
        }
        // Una answer solo vale si hay una oferta local pendiente: una duplicada/stale rompía la negociación.
        if (kind === 'answer' && pc.signalingState !== 'have-local-offer') {
          return;
        }
        this.isSettingRemoteAnswerPending = kind === 'answer';
        await pc.setRemoteDescription(description);
        this.isSettingRemoteAnswerPending = false;
        if (kind === 'offer') {
          await pc.setLocalDescription();
          this.sendLocalDescription();
        }
      } else if (kind === 'ice') {
        // SIN buffer manual: el pc encola addIceCandidate tras setRemoteDescription. Un candidato de una
        // oferta ignorada por glare o anterior al remote description lanza un error INOFENSIVO.
        try {
          await pc.addIceCandidate(data as RTCIceCandidateInit);
        } catch {
          /* candidato obsoleto — inofensivo */
        }
      }
    } catch (err) {
      if (!this.ignoreOffer) {
        console.error('[PeerLink] signal handling error:', err);
      }
    }
  }

  /** Reintento manual (Retry de la sala): vuelve a contar los reinicios. */
  restartIce(): void {
    this.iceRestarts = 0;
    this.doRestartIce();
  }

  close(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }

  // ---------- internos ----------

  /** Orden determinista en AMBOS lados: audio, cámara, pantalla, audio de pantalla (los m-lines se aparean por índice). */
  private addLocalTracks(local: PeerLocalTracks): void {
    const add = (source: PeerTrackSource, track: MediaStreamTrack | null, stream: MediaStream | null) => {
      if (!track) {
        return;
      }
      try {
        const sender = this.pc.addTrack(track, stream ?? new MediaStream([track]));
        this.senders.set(source, sender);
        this.applyDegradationPreference(source, sender);
      } catch {
        /* sin soporte de media (tests) */
      }
    };
    add('microphone', local.microphone, local.stream);
    add('camera', local.camera, local.stream);
    add('screen', local.screen, local.screenStream);
    add('screen-audio', local.screenAudio, local.screenStream);
  }

  private async negotiate(): Promise<void> {
    if (!this.opts.canOffer()) {
      return;
    }
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.sendLocalDescription();
    } catch (err) {
      console.error('[PeerLink] negotiationneeded error:', err);
    } finally {
      this.makingOffer = false;
    }
  }

  private sendLocalDescription(): void {
    const description = this.pc.localDescription;
    if (!description) {
      return;
    }
    const sdp = this.opts.opus ? applyOpusSdpOptions(description.sdp, this.opts.opus) : description.sdp;
    this.opts.signal(description.type as PeerSignalKind, { type: description.type, sdp });
  }

  private handleLinkState(): void {
    const pc = this.pc;
    const state = pc.connectionState === 'failed' ? 'failed' : pc.iceConnectionState;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    switch (decideIceRecovery(state, this.iceRestarts, this.recovery)) {
      case 'recovered':
        this.iceRestarts = 0;
        this.setLinkState('ok');
        break;
      case 'restart-now':
        this.doRestartIce();
        break;
      case 'restart-after-grace':
        this.setLinkState('reconnecting');
        this.graceTimer = setTimeout(() => {
          this.graceTimer = null;
          if (pc.iceConnectionState === 'disconnected') {
            this.doRestartIce();
          }
        }, this.recovery.disconnectedGraceMs);
        break;
      case 'give-up':
        this.setLinkState('failed');
        break;
      default:
        break;
    }
  }

  private doRestartIce(): void {
    this.iceRestarts += 1;
    this.setLinkState('reconnecting');
    if (!this.opts.canOffer()) {
      return; // el otro lado (el que oferta) hace el restart; acá solo se espera
    }
    try {
      this.pc.restartIce(); // la oferta con iceRestart sale por onnegotiationneeded
    } catch {
      this.setLinkState('failed');
    }
  }

  private setLinkState(state: MediaLinkState): void {
    if (this.linkState === state) {
      return;
    }
    this.linkState = state;
    this.opts.onLinkState?.(state);
  }

  private applyDegradationPreferences(): void {
    this.senders.forEach((sender, source) => this.applyDegradationPreference(source, sender));
  }

  /** Cámara: `balanced`; pantalla: `maintain-resolution` (texto legible antes que fps). */
  private applyDegradationPreference(source: PeerTrackSource, sender: RTCRtpSender): void {
    if (source !== 'camera' && source !== 'screen') {
      return;
    }
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      const wanted = source === 'camera' ? 'balanced' : 'maintain-resolution';
      if (params.degradationPreference === wanted) {
        return;
      }
      params.degradationPreference = wanted;
      void sender.setParameters(params).catch(() => undefined);
    } catch {
      /* antes de negociar algunos navegadores no aceptan setParameters: se reintenta al conectar */
    }
  }
}

/**
 * F4 — Fábrica de enlaces mesh. Los orquestadores (llamada 1:1, reunión mesh) no tocan
 * `RTCPeerConnection`: piden un `PeerLink` y trabajan con `replaceTrack`/`handleSignal`.
 */
@Injectable({ providedIn: 'root' })
export class PeerConnectionFactory {
  create(opts: PeerLinkOptions): PeerLink {
    return new PeerLink(opts);
  }
}

/**
 * Munging mínimo del SDP para Opus: `useinbandfec`, `usedtx` y `maxaveragebitrate` en el `a=fmtp` de
 * cada payload Opus (se agrega la línea si no existe). Pura, con test. Conserva el salto de línea
 * original (`\r\n` en SDP real).
 */
export function applyOpusSdpOptions(sdp: string, opts: OpusSdpOptions): string {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(nl);
  const payloads = new Set<string>();
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) opus\/48000(\/\d+)?/i.exec(line);
    if (match) {
      payloads.add(match[1]);
    }
  }
  if (payloads.size === 0) {
    return sdp;
  }
  const wanted: Record<string, string> = {
    useinbandfec: opts.fec ? '1' : '0',
    usedtx: opts.dtx ? '1' : '0',
    ...(opts.maxAverageBitrateKbps ? { maxaveragebitrate: String(opts.maxAverageBitrateKbps * 1000) } : {}),
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (fmtp && payloads.has(fmtp[1])) {
      seen.add(fmtp[1]);
      out.push(`a=fmtp:${fmtp[1]} ${mergeFmtp(fmtp[2], wanted)}`);
      continue;
    }
    out.push(line);
    const rtpmap = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (rtpmap && payloads.has(rtpmap[1]) && !hasFmtp(lines, rtpmap[1])) {
      seen.add(rtpmap[1]);
      out.push(`a=fmtp:${rtpmap[1]} ${mergeFmtp('', wanted)}`);
    }
  }
  return out.join(nl);
}

function hasFmtp(lines: readonly string[], payload: string): boolean {
  return lines.some(line => line.startsWith(`a=fmtp:${payload} `));
}

function mergeFmtp(existing: string, wanted: Record<string, string>): string {
  const params = new Map<string, string>();
  for (const part of existing.split(';')) {
    const [key, value] = part.trim().split('=');
    if (key) {
      params.set(key, value ?? '');
    }
  }
  for (const [key, value] of Object.entries(wanted)) {
    params.set(key, value);
  }
  return [...params.entries()].map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join(';');
}
