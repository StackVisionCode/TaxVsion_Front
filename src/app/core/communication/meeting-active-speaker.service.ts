import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ActiveMeetingService } from './active-meeting.service';
import {
  DEFAULT_SPEAKER_OPTIONS,
  INITIAL_SPEAKER_STATE,
  SpeakerState,
  isSpeakingNow,
  levelBars,
  rmsLevel,
  stepActiveSpeaker,
} from './active-speaker.util';

/** Pista de audio de un remoto, envuelta en su propio MediaStream para un `<audio>` dedicado. */
export interface RemoteAudioSource {
  userId: string;
  trackId: string;
  stream: MediaStream;
}

interface LevelProbe {
  trackId: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
}

/** Cada cuánto se mide el audio (ms). 150 ms basta para la voz y no carga la CPU. */
const TICK_MS = 150;
/** Clave del nivel PROPIO en `levelBars` (los remotos van por userId). */
export const SELF_LEVEL_KEY = 'self';
/** Ticks seguidos con voz en mute antes de avisar "You're muted" (≈ 0,45 s: una palabra, no un roce). */
const MUTED_TALKING_TICKS = 3;
/** Gap mínimo entre dos avisos de "You're muted". */
const MUTED_NOTICE_GAP_MS = 15_000;
const MUTED_NOTICE = "You're muted. Unmute to speak.";

/**
 * Detector de hablante activo + fuente ÚNICA del audio remoto de un meeting.
 *
 * Mientras el meeting está `joined`, cada `TICK_MS`:
 *  1. Descubre la pista de audio de cada remoto (en mesh llega tarde por `ontrack`, en SFU puede
 *     cambiar el stream) y publica `remoteAudio`: un MediaStream por pista, que el mini-player
 *     global reproduce en `<audio>` SIEMPRE montados. Así el audio no se corta al salir de /meetings
 *     y la sala completa NO reproduce audio (sus `<video>` van muted → sin eco ni duplicado).
 *  2. Mide el nivel RMS de cada pista con un AnalyserNode (sin conectarlo a la salida) y aplica la
 *     histéresis de `stepActiveSpeaker` → `activeSpeakerId` y `speakingIds`.
 *
 *  3. F4 (D-41): descubre la pista de AUDIO de cada pantalla compartida (`screenStream`) y la publica
 *     en `remoteScreenAudio`, con volumen propio por participante (`screenAudioVolume`), para que el
 *     mini-player la reproduzca en su propio `<audio>` (el `<video>` de la sala va muted).
 *
 *  4. F5 (T-69): mide MI micrófono por el clon de medición (`localMeterTrack`, capta aunque esté en
 *     mute): `selfSpeaking` + anillo/medidor propios, "You're muted" si hablo con el mic apagado (toast
 *     con gap) y `reportSpeaking` al orquestador cuando cambia mi estado (él aplica el tope de la
 *     política). `levelBars` da las 3 barras del medidor por participante (y `SELF_LEVEL_KEY` la mía).
 *     El `AudioContext` se crea en el gesto de entrar (`primeAudioContext`) y `audioSuspended` avisa
 *     si el navegador lo dejó suspendido.
 *
 * Sin WebAudio (jsdom, navegador viejo) el audio se sigue publicando; solo no hay detección.
 * Uso: inyectarlo y leer los signals; arranca/para solo con la fase del meeting.
 */
@Injectable({ providedIn: 'root' })
export class MeetingActiveSpeakerService {
  private readonly meeting = inject(ActiveMeetingService);
  private readonly toast = inject(ToastService);

  /** Remoto que tiene la palabra (con histéresis); se conserva el último aunque calle. */
  readonly activeSpeakerId = signal<string | null>(null);
  /** Remotos hablando ahora mismo (indicador visual, con cola anti-parpadeo). */
  readonly speakingIds = signal<ReadonlySet<string>>(new Set());
  /** Último instante con voz por remoto (orden de las miniaturas). Solo cambia cuando cambia `speakingIds`. */
  readonly lastVoiceAt = signal<Readonly<Record<string, number>>>({});
  /** Audio remoto a reproducir (una entrada por pista). */
  readonly remoteAudio = signal<readonly RemoteAudioSource[]>([]);
  /** Audio de las pantallas compartidas (una entrada por participante compartiendo con audio). */
  readonly remoteScreenAudio = signal<readonly RemoteAudioSource[]>([]);
  /** Volumen (0–1) por participante del audio de SU pantalla; ausente = 1. */
  readonly screenAudioVolumes = signal<Readonly<Record<string, number>>>({});
  /** F5 — barras del medidor (0–3) por userId remoto y `SELF_LEVEL_KEY`; solo cambia cuando cambia alguna barra. */
  readonly levelBars = signal<Readonly<Record<string, number>>>({});
  /** F5 — estoy hablando (mic abierto y voz reciente, con la misma cola anti-parpadeo). */
  readonly selfSpeaking = signal(false);
  /** F5 — el navegador mantiene el AudioContext suspendido (sin gesto): la sala ofrece "Enable audio". */
  readonly audioSuspended = signal(false);

  private state: SpeakerState = INITIAL_SPEAKER_STATE;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: AudioContext | null = null;
  private audioUnsupported = false;
  private readonly probes = new Map<string, LevelProbe>();
  private selfProbe: LevelProbe | null = null;
  private selfLastVoiceAt = -Infinity;
  private mutedTalkingTicks = 0;
  private lastMutedNoticeAt = -Infinity;

  constructor() {
    // Solo depende de la fase: el primer tick (que lee peers/participantes) va fuera del tracking.
    effect(() => {
      const joined = this.meeting.phase() === 'joined';
      untracked(() => (joined ? this.start() : this.stop()));
    });
  }

  screenAudioVolume(userId: string): number {
    return this.screenAudioVolumes()[userId] ?? 1;
  }

  /** Barras (0–3) de un participante; `SELF_LEVEL_KEY` para mí. */
  barsOf(userId: string): number {
    return this.levelBars()[userId] ?? 0;
  }

  /**
   * F5 — crear/reanudar el AudioContext DENTRO de un gesto del usuario (el clic de "Join" / "Enable
   * audio"): sin gesto, Chrome lo deja `suspended` y no hay detección ni medidor.
   */
  async primeAudioContext(): Promise<boolean> {
    if (this.audioUnsupported || typeof AudioContext === 'undefined') {
      return false;
    }
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } catch {
      /* sin WebAudio o sin gesto: se queda suspendido */
    }
    const running = this.ctx?.state === 'running';
    this.audioSuspended.set(!running);
    return running;
  }

  setScreenAudioVolume(userId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.screenAudioVolumes.update(map => ({ ...map, [userId]: clamped }));
  }

  private start(): void {
    if (this.timer) {
      return;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.probes.forEach(probe => this.disposeProbe(probe));
    this.probes.clear();
    if (this.selfProbe) {
      this.disposeProbe(this.selfProbe);
      this.selfProbe = null;
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.state = INITIAL_SPEAKER_STATE;
    this.activeSpeakerId.set(null);
    this.speakingIds.set(new Set());
    this.lastVoiceAt.set({});
    this.remoteAudio.set([]);
    this.remoteScreenAudio.set([]);
    this.screenAudioVolumes.set({});
    this.levelBars.set({});
    this.selfSpeaking.set(false);
    this.audioSuspended.set(false);
    this.selfLastVoiceAt = -Infinity;
    this.mutedTalkingTicks = 0;
  }

  private tick(): void {
    const peers = this.meeting.peers();
    const remotes = this.meeting.remoteParticipants();
    const now = performance.now();
    const levels: Record<string, number> = {};
    const audio: RemoteAudioSource[] = [];
    const screenAudio: RemoteAudioSource[] = [];
    const previous = new Map(this.remoteAudio().map(source => [source.userId, source]));
    const previousScreen = new Map(this.remoteScreenAudio().map(source => [source.userId, source]));

    for (const participant of remotes) {
      const peer = peers.get(participant.userId);
      // Audio de la pantalla (D-41): solo mientras el roster dice que comparte y la pista está viva.
      const screenTrack = participant.screenSharing ? peer?.screenStream.getAudioTracks().find(t => t.readyState === 'live') : undefined;
      if (screenTrack) {
        const knownScreen = previousScreen.get(participant.userId);
        screenAudio.push(
          knownScreen && knownScreen.trackId === screenTrack.id
            ? knownScreen
            : { userId: participant.userId, trackId: screenTrack.id, stream: new MediaStream([screenTrack]) },
        );
      }
      const track = peer?.cameraStream.getAudioTracks().find(t => t.readyState === 'live');
      if (!track) {
        levels[participant.userId] = 0;
        this.dropProbe(participant.userId);
        continue;
      }
      // Se reusa el MediaStream si la pista no cambió (el <audio> no se re-crea ni se corta).
      const known = previous.get(participant.userId);
      audio.push(known && known.trackId === track.id ? known : { userId: participant.userId, trackId: track.id, stream: new MediaStream([track]) });
      levels[participant.userId] = participant.audioEnabled ? this.levelOf(participant.userId, track) : 0;
    }

    // Probes de quien ya salió.
    const present = new Set(remotes.map(p => p.userId));
    [...this.probes.keys()].filter(id => !present.has(id)).forEach(id => this.dropProbe(id));

    if (!sameAudio(this.remoteAudio(), audio)) {
      this.remoteAudio.set(audio);
    }
    if (!sameAudio(this.remoteScreenAudio(), screenAudio)) {
      this.remoteScreenAudio.set(screenAudio);
    }

    this.state = stepActiveSpeaker(this.state, levels, now);
    if (this.state.current !== this.activeSpeakerId()) {
      this.activeSpeakerId.set(this.state.current);
    }
    const speaking = new Set(Object.keys(levels).filter(id => isSpeakingNow(this.state, id, now, DEFAULT_SPEAKER_OPTIONS)));
    if (!sameSet(this.speakingIds(), speaking)) {
      this.speakingIds.set(speaking);
      this.lastVoiceAt.set(this.state.lastVoiceAt);
    }

    // F5 — mi propio nivel (clon del micrófono: mide también en mute) → medidor, anillo, "You're muted" y timeline.
    const selfLevel = this.selfLevel();
    const bars: Record<string, number> = {};
    for (const id of Object.keys(levels)) {
      bars[id] = levelBars(levels[id]);
    }
    bars[SELF_LEVEL_KEY] = levelBars(selfLevel);
    if (!sameRecord(this.levelBars(), bars)) {
      this.levelBars.set(bars);
    }
    this.trackSelfSpeaking(selfLevel, now);
  }

  /** Nivel RMS de mi micrófono (0 sin pista, sin WebAudio o con el hardware liberado). */
  private selfLevel(): number {
    const track = this.meeting.localMeterTrack();
    if (!track) {
      if (this.selfProbe) {
        this.disposeProbe(this.selfProbe);
        this.selfProbe = null;
      }
      return 0;
    }
    if (this.selfProbe && this.selfProbe.trackId !== track.id) {
      this.disposeProbe(this.selfProbe);
      this.selfProbe = null;
    }
    this.selfProbe ??= this.createProbe(track);
    if (!this.selfProbe) {
      return 0;
    }
    this.selfProbe.analyser.getByteTimeDomainData(this.selfProbe.buffer);
    return rmsLevel(this.selfProbe.buffer);
  }

  private trackSelfSpeaking(level: number, now: number): void {
    const voice = level >= DEFAULT_SPEAKER_OPTIONS.threshold;
    const micOpen = this.meeting.audioEnabled();
    if (voice) {
      this.selfLastVoiceAt = now;
    }
    const speaking = micOpen && now - this.selfLastVoiceAt <= DEFAULT_SPEAKER_OPTIONS.holdMs;
    if (speaking !== this.selfSpeaking()) {
      this.selfSpeaking.set(speaking);
      this.meeting.reportSpeaking(speaking);
    }
    // Hablo con el micrófono en mute: aviso (con gap para no insistir en cada frase).
    if (!micOpen && voice) {
      this.mutedTalkingTicks++;
      if (this.mutedTalkingTicks >= MUTED_TALKING_TICKS && now - this.lastMutedNoticeAt >= MUTED_NOTICE_GAP_MS) {
        this.lastMutedNoticeAt = now;
        this.toast.info(MUTED_NOTICE);
      }
    } else {
      this.mutedTalkingTicks = 0;
    }
  }

  /** Nivel RMS (0–1) de la pista; 0 si no hay WebAudio. Crea/rehace el probe si cambió la pista. */
  private levelOf(userId: string, track: MediaStreamTrack): number {
    let probe = this.probes.get(userId);
    if (probe && probe.trackId !== track.id) {
      this.dropProbe(userId);
      probe = undefined;
    }
    if (!probe) {
      probe = this.createProbe(track) ?? undefined;
      if (!probe) {
        return 0;
      }
      this.probes.set(userId, probe);
    }
    probe.analyser.getByteTimeDomainData(probe.buffer);
    return rmsLevel(probe.buffer);
  }

  private createProbe(track: MediaStreamTrack): LevelProbe | null {
    if (this.audioUnsupported) {
      return null;
    }
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined); // sin gesto previo puede seguir suspendido; best-effort
      }
      this.audioSuspended.set(this.ctx.state === 'suspended');
      const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // NO a destination: solo se mide, el audio suena por el <audio>
      return { trackId: track.id, source, analyser, buffer: new Uint8Array(analyser.fftSize) };
    } catch {
      this.audioUnsupported = true;
      return null;
    }
  }

  private dropProbe(userId: string): void {
    const probe = this.probes.get(userId);
    if (probe) {
      this.disposeProbe(probe);
      this.probes.delete(userId);
    }
  }

  private disposeProbe(probe: LevelProbe): void {
    try {
      probe.source.disconnect();
      probe.analyser.disconnect();
    } catch {
      /* ya desconectado */
    }
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every(id => b.has(id));
}

function sameRecord(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k]);
}

function sameAudio(a: readonly RemoteAudioSource[], b: readonly RemoteAudioSource[]): boolean {
  return a.length === b.length && a.every((source, i) => source === b[i]);
}
