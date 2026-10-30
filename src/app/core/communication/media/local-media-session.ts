import { computed, signal } from '@angular/core';
import { MediaAccessError } from './media-errors';
import type { MediaDevicesService } from './media-devices.service';
import { MediaPolicyDto } from './media-policy.model';

/** Fuente de una pista local que el orquestador tiene que volver a aplicar (replaceTrack) en cada pc/producer. */
export type LocalTrackSource = 'microphone' | 'camera' | 'screen' | 'screen-audio';
/** Por qué está restringido el audio/video (C-11: un solo estado de UI con motivo). */
export type MuteReason = 'user' | 'echo' | 'network' | 'host';
export type CameraProfile = 'camera' | 'meshCamera';

export interface LocalMediaSessionHandlers {
  /**
   * Una pista local cambió (cámara on/off, swap de micro, pantalla, micrófono liberado…): el
   * orquestador aplica `replaceTrack` en cada RTCPeerConnection / producer. `null` = dejar de enviar.
   */
  onLocalTrackReplaced(source: LocalTrackSource, track: MediaStreamTrack | null): void | Promise<void>;
  /** La pantalla dejó de compartirse (botón propio o "Stop sharing" del navegador): avisar al servidor. */
  onScreenShareStopped?(): void;
}

export interface AcquireOptions {
  audio: boolean;
  video: boolean;
  /** `meshCamera` = perfil reducido para mesh con varios peers. */
  profile?: CameraProfile;
}

export interface AcquireResult {
  audio: boolean;
  video: boolean;
  /** Error de la cámara (si se pidió y no se pudo; puede haber caído a solo audio). */
  videoError: MediaAccessError | null;
  /** Error del micrófono (si no se pudo capturar nada). */
  audioError: MediaAccessError | null;
}

export interface ScreenShareOptions {
  withAudio: boolean;
  /** Contenido en movimiento (video): fps `screen.videoFps` y `contentHint='motion'`. */
  optimizeForVideo?: boolean;
}

const MS_PER_MINUTE = 60_000;

/**
 * F4 — Captura local de UNA sesión (llamada o reunión): micrófono, cámara y pantalla con las
 * constraints de la política (resolución/fps/AEC/NS/AGC), placeholders para m-lines persistentes,
 * mute con liberación del hardware, cambio de dispositivo en caliente y pantalla con audio dedicado.
 * No conoce RTCPeerConnection ni mediasoup: cada cambio de pista se avisa por `onLocalTrackReplaced`.
 *
 * `stream()` es la vista previa local (audio + cámara o placeholder); `screenStream()` la pantalla.
 * Se crea con `LocalMediaSessionFactory.create(policy, handlers)` y se cierra con `release()`.
 */
export class LocalMediaSession {
  readonly stream = signal<MediaStream | null>(null);
  readonly screenStream = signal<MediaStream | null>(null);
  readonly audioEnabled = signal(true);
  readonly videoEnabled = signal(false);
  readonly screenSharing = signal(false);
  /** Audio de la pantalla compartida como pista dedicada (D-41); null si no hay. */
  readonly screenAudioTrack = signal<MediaStreamTrack | null>(null);
  /** El video propio está pausado por la red (D-40) sin tocar el estado de cámara del usuario. */
  readonly videoPausedByNetwork = signal(false);
  /** Micrófono liberado por mute prolongado (se re-adquiere al desmutear). */
  readonly microphoneReleased = signal(false);
  private readonly audioMuteReason = signal<MuteReason | null>(null);
  /** Motivo de la restricción vigente: pausa de red manda; si no, el motivo del mute de audio. */
  readonly muteReason = computed<MuteReason | null>(() => (this.videoPausedByNetwork() ? 'network' : this.audioMuteReason()));

  private audioTrack: MediaStreamTrack | null = null;
  /** Clon del micrófono SOLO para medir nivel (F5 "You're muted"): el original va en mute, el clon sigue captando. */
  private meterClone: MediaStreamTrack | null = null;
  private meterCloneOf: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private cameraPlaceholder: MediaStream | null = null;
  private screenPlaceholder: MediaStream | null = null;
  private silenceCtx: AudioContext | null = null;
  private readonly silenceStreams = new Map<'mic' | 'screen', MediaStream>();
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private cameraProfile: CameraProfile = 'camera';
  private released = false;

  constructor(
    private readonly policy: MediaPolicyDto,
    private readonly devices: MediaDevicesService,
    private readonly handlers: LocalMediaSessionHandlers,
  ) {}

  // ---------- Captura inicial ----------

  /**
   * Una sola captura con las constraints de la política. Si cámara+micro falla (cámara ocupada o sin
   * permiso) cae a solo audio. SIEMPRE deja una pista de video (cámara o placeholder negro) para que el
   * m-line de video exista desde el principio y prender cámara / compartir sea `replaceTrack`.
   */
  async acquire(opts: AcquireOptions): Promise<AcquireResult> {
    this.cameraProfile = opts.profile ?? 'camera';
    const result: AcquireResult = { audio: false, video: false, videoError: null, audioError: null };
    let stream: MediaStream | null = null;
    if (opts.audio || opts.video) {
      try {
        stream = await this.devices.getUserMedia(
          { audio: opts.audio ? this.audioConstraints() : false, video: opts.video ? this.cameraConstraints() : false },
          opts.video ? 'camera' : 'microphone',
        );
      } catch (err) {
        if (opts.video) {
          result.videoError = err as MediaAccessError;
        } else {
          result.audioError = err as MediaAccessError;
        }
        if (opts.audio && opts.video) {
          try {
            stream = await this.devices.getUserMedia({ audio: this.audioConstraints(), video: false }, 'microphone');
          } catch (err2) {
            result.audioError = err2 as MediaAccessError;
          }
        }
      }
    }
    if (this.released) {
      stream?.getTracks().forEach(t => t.stop());
      return result;
    }
    const local = stream ?? this.newStream();
    this.adoptAudioTrack(local?.getAudioTracks()[0] ?? null);
    this.adoptCameraTrack(local?.getVideoTracks()[0] ?? null);
    result.audio = !!this.audioTrack;
    result.video = !!this.cameraTrack;
    if (!this.cameraTrack) {
      const placeholder = this.ensureCameraPlaceholder();
      if (placeholder && local) {
        local.addTrack(placeholder);
      }
    }
    this.stream.set(local);
    this.audioEnabled.set(result.audio);
    this.videoEnabled.set(result.video);
    return result;
  }

  // ---------- Pistas de salida (lo que va a cada pc/producer) ----------

  /** Micrófono, o silencio deshabilitado si no hay (mantiene el m-line de audio en su sitio). */
  audioOutTrack(): MediaStreamTrack | null {
    return this.audioTrack ?? this.ensureSilencePlaceholder('mic');
  }

  /**
   * Pista para MEDIR el micrófono (nunca se publica): clon de la pista actual, que capta aunque la
   * original esté `enabled=false` por mute. Se rehace al cambiar de micrófono y muere con él (mute
   * prolongado que libera el hardware → null). Llamarla en cada tick: ella misma se mantiene al día.
   */
  meterTrack(): MediaStreamTrack | null {
    if (this.meterCloneOf !== this.audioTrack || this.meterClone?.readyState === 'ended') {
      this.meterClone?.stop();
      this.meterClone = null;
      this.meterCloneOf = this.audioTrack;
      if (this.audioTrack && typeof this.audioTrack.clone === 'function') {
        try {
          this.meterClone = this.audioTrack.clone();
          this.meterClone.enabled = true;
        } catch {
          this.meterClone = null;
        }
      }
    }
    return this.meterClone;
  }
  /** Cámara real o placeholder negro deshabilitado (mantiene vivo el m-line). */
  cameraOutTrack(): MediaStreamTrack | null {
    return this.cameraTrack ?? this.ensureCameraPlaceholder();
  }
  /** Pantalla real o placeholder (2º m-line de video). */
  screenOutTrack(): MediaStreamTrack | null {
    return this.screenTrack ?? this.ensureScreenPlaceholder();
  }
  /** Audio de pantalla real o silencio deshabilitado (m-line de audio de pantalla en mesh). */
  screenAudioOutTrack(): MediaStreamTrack | null {
    return this.screenAudioTrack() ?? this.ensureSilencePlaceholder('screen');
  }
  /** Stream "de salida" de la pantalla (real o placeholder) para `addTrack(track, stream)`. */
  screenOutStream(): MediaStream | null {
    return this.screenStream() ?? this.screenPlaceholder;
  }

  // ---------- Micrófono ----------

  /**
   * Mute = `enabled=false` al instante; si la política lo pide, tras N minutos se LIBERA el micrófono
   * (LED/indicador del SO apagado). Al desmutear se re-adquiere con el mismo dispositivo.
   */
  async setAudioEnabled(enabled: boolean, reason: MuteReason = 'user'): Promise<void> {
    this.clearReleaseTimer();
    if (!enabled) {
      this.audioEnabled.set(false);
      this.audioMuteReason.set(reason);
      if (this.audioTrack) {
        this.audioTrack.enabled = false;
      }
      const minutes = this.policy.audio.muteReleasesHardwareMinutes;
      if (minutes > 0 && this.audioTrack) {
        this.releaseTimer = setTimeout(() => void this.releaseMicrophone(), minutes * MS_PER_MINUTE);
      }
      return;
    }
    if (this.microphoneReleased() || !this.audioTrack) {
      await this.reacquireMicrophone();
    }
    if (this.audioTrack) {
      this.audioTrack.enabled = true;
    }
    this.audioEnabled.set(!!this.audioTrack);
    this.audioMuteReason.set(null);
  }

  toggleAudio(reason: MuteReason = 'user'): Promise<void> {
    return this.setAudioEnabled(!this.audioEnabled(), reason);
  }

  /** Cambia el micrófono en caliente (replaceTrack vía handler, sin renegociar). */
  async swapMicrophone(deviceId: string): Promise<boolean> {
    let captured: MediaStream;
    try {
      captured = await this.devices.getUserMedia({ audio: this.audioConstraints(deviceId), video: false }, 'microphone');
    } catch {
      return false;
    }
    const track = captured.getAudioTracks()[0] ?? null;
    if (!track) {
      return false;
    }
    this.devices.setPreferred('audioInputId', deviceId);
    const previous = this.audioTrack;
    this.adoptAudioTrack(track);
    track.enabled = this.audioEnabled();
    this.swapStreamTrack(previous, track);
    this.stopTrack(previous);
    this.microphoneReleased.set(false);
    await this.handlers.onLocalTrackReplaced('microphone', track);
    return true;
  }

  // ---------- Cámara ----------

  /** Apagar = DETENER la cámara (LED off) + placeholder; encender = adquirir y publicar con replaceTrack. */
  async setVideoEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.videoEnabled.set(false);
      const previous = this.cameraTrack;
      this.cameraTrack = null;
      this.devices.setActive('camera', null);
      const placeholder = this.ensureCameraPlaceholder();
      this.swapStreamTrack(previous, placeholder);
      this.stopTrack(previous);
      await this.handlers.onLocalTrackReplaced('camera', placeholder);
      return true;
    }
    let captured: MediaStream;
    try {
      captured = await this.devices.getUserMedia({ audio: false, video: this.cameraConstraints() }, 'camera');
    } catch {
      this.videoEnabled.set(false);
      return false;
    }
    const track = captured.getVideoTracks()[0] ?? null;
    if (!track) {
      return false;
    }
    const previous = this.cameraTrack;
    this.adoptCameraTrack(track);
    if (this.videoPausedByNetwork()) {
      track.enabled = false; // sigue pausada por la red hasta recuperarse
    }
    this.swapStreamTrack(previous ?? this.cameraPlaceholder?.getVideoTracks()[0] ?? null, track);
    this.stopTrack(previous);
    this.videoEnabled.set(true);
    await this.handlers.onLocalTrackReplaced('camera', track);
    return true;
  }

  toggleVideo(): Promise<boolean> {
    return this.setVideoEnabled(!this.videoEnabled());
  }

  /** Cambia la cámara en caliente (si está apagada, solo queda como preferida). */
  async swapCamera(deviceId: string): Promise<boolean> {
    this.devices.setPreferred('videoInputId', deviceId);
    if (!this.videoEnabled()) {
      return true;
    }
    let captured: MediaStream;
    try {
      captured = await this.devices.getUserMedia({ audio: false, video: this.cameraConstraints(deviceId) }, 'camera');
    } catch {
      return false;
    }
    const track = captured.getVideoTracks()[0] ?? null;
    if (!track) {
      return false;
    }
    const previous = this.cameraTrack;
    this.adoptCameraTrack(track);
    this.swapStreamTrack(previous, track);
    this.stopTrack(previous);
    await this.handlers.onLocalTrackReplaced('camera', track);
    return true;
  }

  /** Reajusta resolución/fps de la cámara viva (p. ej. mesh con ≥ 3 peers → `meshCamera`), sin re-adquirir. */
  async applyCameraProfile(profile: CameraProfile): Promise<void> {
    this.cameraProfile = profile;
    if (!this.cameraTrack) {
      return;
    }
    const { deviceId: _omit, ...constraints } = this.cameraConstraints();
    try {
      await this.cameraTrack.applyConstraints(constraints);
    } catch {
      /* el navegador no pudo aplicar el perfil: se sigue con el actual */
    }
  }

  // ---------- Modo solo audio automático (D-40) ----------

  /** Pausa el envío de cámara por red (enabled=false) SIN tocar `videoEnabled` (estado del usuario). */
  pauseVideoForNetwork(): void {
    if (this.videoPausedByNetwork()) {
      return;
    }
    this.videoPausedByNetwork.set(true);
    if (this.cameraTrack) {
      this.cameraTrack.enabled = false;
    }
  }

  resumeVideoAfterNetwork(): void {
    if (!this.videoPausedByNetwork()) {
      return;
    }
    this.videoPausedByNetwork.set(false);
    if (this.cameraTrack) {
      this.cameraTrack.enabled = true;
    }
  }

  // ---------- Pantalla (T-52 / D-41) ----------

  async startScreenShare(opts: ScreenShareOptions): Promise<boolean> {
    if (this.screenSharing()) {
      return true;
    }
    const screen = this.policy.video.screen;
    const fps = opts.optimizeForVideo ? screen.videoFps : screen.maxFps;
    let display: MediaStream;
    try {
      display = await this.devices.getDisplayMedia({
        video: {
          width: { max: screen.maxWidth },
          height: { max: screen.maxHeight },
          frameRate: { max: fps },
        },
        audio: opts.withAudio && this.policy.screenShare.audioAllowed,
      });
    } catch {
      return false; // cancelado o no disponible: sin ruido
    }
    const track = display.getVideoTracks()[0];
    if (!track || this.released) {
      display.getTracks().forEach(t => t.stop());
      return false;
    }
    try {
      track.contentHint = opts.optimizeForVideo ? 'motion' : 'detail';
    } catch {
      /* sin soporte de contentHint */
    }
    // El botón nativo "Stop sharing" del navegador: instalado ANTES de cualquier await.
    track.onended = () => void this.stopScreenShare();
    this.screenTrack = track;
    this.screenStream.set(display);
    this.screenSharing.set(true);
    const audio = this.policy.screenShare.audioAllowed ? (display.getAudioTracks()[0] ?? null) : null;
    display.getAudioTracks().forEach(t => {
      if (t !== audio) {
        t.stop();
      }
    });
    this.screenAudioTrack.set(audio);
    await this.handlers.onLocalTrackReplaced('screen', track);
    if (audio) {
      await this.handlers.onLocalTrackReplaced('screen-audio', audio);
    }
    return true;
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenSharing()) {
      return;
    }
    const hadAudio = !!this.screenAudioTrack();
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.screenAudioTrack()?.stop();
    this.screenAudioTrack.set(null);
    this.screenStream()?.getTracks().forEach(t => t.stop());
    this.screenStream.set(null);
    this.screenSharing.set(false);
    await this.handlers.onLocalTrackReplaced('screen', this.ensureScreenPlaceholder());
    if (hadAudio) {
      await this.handlers.onLocalTrackReplaced('screen-audio', this.ensureSilencePlaceholder('screen'));
    }
    this.handlers.onScreenShareStopped?.();
  }

  // ---------- Diagnóstico y cierre ----------

  /** `getSettings()` de cada pista viva, para el log de diagnóstico. */
  trackSettingsSnapshot(): { microphone: MediaTrackSettings | null; camera: MediaTrackSettings | null; screen: MediaTrackSettings | null } {
    const settingsOf = (track: MediaStreamTrack | null) => {
      try {
        return track && track.readyState === 'live' ? track.getSettings() : null;
      } catch {
        return null;
      }
    };
    return { microphone: settingsOf(this.audioTrack), camera: settingsOf(this.cameraTrack), screen: settingsOf(this.screenTrack) };
  }

  /** Apaga todo el hardware y los placeholders. Idempotente. */
  release(): void {
    this.released = true;
    this.clearReleaseTimer();
    this.meterClone?.stop();
    this.meterClone = null;
    this.meterCloneOf = null;
    this.stopTrack(this.audioTrack);
    this.audioTrack = null;
    this.stopTrack(this.cameraTrack);
    this.cameraTrack = null;
    this.stopTrack(this.screenTrack);
    this.screenTrack = null;
    this.screenAudioTrack()?.stop();
    this.screenAudioTrack.set(null);
    this.screenStream()?.getTracks().forEach(t => t.stop());
    this.screenStream.set(null);
    this.stream()?.getTracks().forEach(t => t.stop());
    this.stream.set(null);
    this.cameraPlaceholder?.getTracks().forEach(t => t.stop());
    this.cameraPlaceholder = null;
    this.screenPlaceholder?.getTracks().forEach(t => t.stop());
    this.screenPlaceholder = null;
    this.silenceStreams.forEach(stream => stream.getTracks().forEach(t => t.stop()));
    this.silenceStreams.clear();
    void this.silenceCtx?.close().catch(() => undefined);
    this.silenceCtx = null;
    this.devices.setActive('microphone', null);
    this.devices.setActive('camera', null);
    this.screenSharing.set(false);
    this.videoPausedByNetwork.set(false);
    this.microphoneReleased.set(false);
  }

  // ---------- internos ----------

  private audioConstraints(deviceId: string | null = this.devices.preferred().audioInputId): MediaTrackConstraints {
    const processing = this.policy.audio.processing;
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: processing.echoCancellation,
      noiseSuppression: processing.noiseSuppression,
      autoGainControl: processing.autoGainControl,
    };
  }

  private cameraConstraints(deviceId: string | null = this.devices.preferred().videoInputId): MediaTrackConstraints {
    const profile = this.policy.video[this.cameraProfile];
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: profile.maxWidth, max: profile.maxWidth },
      height: { ideal: profile.maxHeight, max: profile.maxHeight },
      frameRate: { ideal: profile.maxFps, max: profile.maxFps },
    };
  }

  private adoptAudioTrack(track: MediaStreamTrack | null): void {
    this.audioTrack = track;
    this.devices.setActive('microphone', track ? (settingsDeviceId(track) ?? null) : null);
    if (track) {
      track.onended = () => void this.onDeviceLost('microphone');
    }
  }

  private adoptCameraTrack(track: MediaStreamTrack | null): void {
    this.cameraTrack = track;
    this.devices.setActive('camera', track ? (settingsDeviceId(track) ?? null) : null);
    if (track) {
      track.onended = () => void this.onDeviceLost('camera');
    }
  }

  /** El dispositivo se desconectó en caliente: pasar al siguiente disponible o quedarse sin él. */
  private async onDeviceLost(kind: 'microphone' | 'camera'): Promise<void> {
    if (this.released) {
      return;
    }
    const lostId = kind === 'microphone' ? this.devices.activeMicrophoneId() : this.devices.activeCameraId();
    await this.devices.refreshInventory();
    const fallback = this.devices.pickFallback(kind, lostId);
    let replaced = false;
    if (fallback) {
      replaced = kind === 'microphone' ? await this.swapMicrophone(fallback.deviceId) : await this.swapCamera(fallback.deviceId);
    }
    if (!replaced) {
      if (kind === 'microphone') {
        this.swapStreamTrack(this.audioTrack, null);
        this.audioTrack = null;
        this.audioEnabled.set(false);
        this.devices.setActive('microphone', null);
        await this.handlers.onLocalTrackReplaced('microphone', null);
      } else {
        const placeholder = this.ensureCameraPlaceholder();
        this.swapStreamTrack(this.cameraTrack, placeholder);
        this.cameraTrack = null;
        this.videoEnabled.set(false);
        this.devices.setActive('camera', null);
        await this.handlers.onLocalTrackReplaced('camera', placeholder);
      }
    }
    this.devices.notifyDeviceLost(kind, replaced);
  }

  private async releaseMicrophone(): Promise<void> {
    this.releaseTimer = null;
    if (this.audioEnabled() || !this.audioTrack) {
      return;
    }
    const track = this.audioTrack;
    this.audioTrack = null;
    this.swapStreamTrack(track, null);
    this.stopTrack(track);
    this.microphoneReleased.set(true);
    await this.handlers.onLocalTrackReplaced('microphone', null);
  }

  private async reacquireMicrophone(): Promise<void> {
    let captured: MediaStream;
    try {
      captured = await this.devices.getUserMedia({ audio: this.audioConstraints(), video: false }, 'microphone');
    } catch {
      return;
    }
    const track = captured.getAudioTracks()[0] ?? null;
    if (!track) {
      return;
    }
    this.adoptAudioTrack(track);
    this.swapStreamTrack(null, track);
    this.microphoneReleased.set(false);
    await this.handlers.onLocalTrackReplaced('microphone', track);
  }

  /** Reemplaza una pista en el stream de preview (removeTrack NO detiene la pista). */
  private swapStreamTrack(previous: MediaStreamTrack | null, next: MediaStreamTrack | null): void {
    const stream = this.stream();
    if (!stream) {
      return;
    }
    if (previous && stream.getTracks().includes(previous)) {
      stream.removeTrack(previous);
    }
    if (next && !stream.getTracks().includes(next)) {
      stream.addTrack(next);
    }
  }

  private stopTrack(track: MediaStreamTrack | null): void {
    if (!track) {
      return;
    }
    track.onended = null;
    track.stop();
  }

  private clearReleaseTimer(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  private newStream(): MediaStream | null {
    try {
      return new MediaStream();
    } catch {
      return null; // jsdom
    }
  }

  /** Canvas 2×2 negro a 1 fps, pista deshabilitada (no transmite). Se crea una vez y se reusa. */
  private ensureCameraPlaceholder(): MediaStreamTrack | null {
    const existing = this.cameraPlaceholder?.getVideoTracks()[0];
    if (existing && existing.readyState === 'live') {
      return existing;
    }
    this.cameraPlaceholder = blackCanvasStream();
    return this.cameraPlaceholder?.getVideoTracks()[0] ?? null;
  }

  /** Igual que la cámara pero pista PROPIA (una pista no puede ir en dos senders del mismo pc). */
  private ensureScreenPlaceholder(): MediaStreamTrack | null {
    const existing = this.screenPlaceholder?.getVideoTracks()[0];
    if (existing && existing.readyState === 'live') {
      return existing;
    }
    this.screenPlaceholder = blackCanvasStream();
    return this.screenPlaceholder?.getVideoTracks()[0] ?? null;
  }

  /** Silencio (AudioContext sin fuente) deshabilitado: mantiene vivo un m-line de audio sin micrófono / audio de pantalla. */
  private ensureSilencePlaceholder(key: 'mic' | 'screen'): MediaStreamTrack | null {
    const existing = this.silenceStreams.get(key)?.getAudioTracks()[0];
    if (existing && existing.readyState === 'live') {
      return existing;
    }
    try {
      this.silenceCtx ??= new AudioContext();
      const stream = this.silenceCtx.createMediaStreamDestination().stream;
      this.silenceStreams.set(key, stream);
      const track = stream.getAudioTracks()[0] ?? null;
      if (track) {
        track.enabled = false;
      }
      return track;
    } catch {
      return null; // sin WebAudio (jsdom): sin m-line de audio de pantalla
    }
  }
}

function settingsDeviceId(track: MediaStreamTrack): string | undefined {
  try {
    return track.getSettings().deviceId;
  } catch {
    return undefined;
  }
}

function blackCanvasStream(): MediaStream | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext('2d')?.fillRect(0, 0, 2, 2);
    const stream = (canvas as HTMLCanvasElement & { captureStream(frameRate?: number): MediaStream }).captureStream(1);
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.enabled = false;
    }
    return stream;
  } catch {
    return null; // jsdom (tests) o navegador sin captureStream
  }
}
