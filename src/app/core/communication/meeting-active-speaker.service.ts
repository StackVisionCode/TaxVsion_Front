import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ActiveMeetingService } from './active-meeting.service';
import {
  DEFAULT_SPEAKER_OPTIONS,
  INITIAL_SPEAKER_STATE,
  SpeakerState,
  isSpeakingNow,
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
 * Sin WebAudio (jsdom, navegador viejo) el audio se sigue publicando; solo no hay detección.
 * Uso: inyectarlo y leer los signals; arranca/para solo con la fase del meeting.
 */
@Injectable({ providedIn: 'root' })
export class MeetingActiveSpeakerService {
  private readonly meeting = inject(ActiveMeetingService);

  /** Remoto que tiene la palabra (con histéresis); se conserva el último aunque calle. */
  readonly activeSpeakerId = signal<string | null>(null);
  /** Remotos hablando ahora mismo (indicador visual, con cola anti-parpadeo). */
  readonly speakingIds = signal<ReadonlySet<string>>(new Set());
  /** Último instante con voz por remoto (orden de las miniaturas). Solo cambia cuando cambia `speakingIds`. */
  readonly lastVoiceAt = signal<Readonly<Record<string, number>>>({});
  /** Audio remoto a reproducir (una entrada por pista). */
  readonly remoteAudio = signal<readonly RemoteAudioSource[]>([]);

  private state: SpeakerState = INITIAL_SPEAKER_STATE;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: AudioContext | null = null;
  private audioUnsupported = false;
  private readonly probes = new Map<string, LevelProbe>();

  constructor() {
    // Solo depende de la fase: el primer tick (que lee peers/participantes) va fuera del tracking.
    effect(() => {
      const joined = this.meeting.phase() === 'joined';
      untracked(() => (joined ? this.start() : this.stop()));
    });
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
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.state = INITIAL_SPEAKER_STATE;
    this.activeSpeakerId.set(null);
    this.speakingIds.set(new Set());
    this.lastVoiceAt.set({});
    this.remoteAudio.set([]);
  }

  private tick(): void {
    const peers = this.meeting.peers();
    const remotes = this.meeting.remoteParticipants();
    const now = performance.now();
    const levels: Record<string, number> = {};
    const audio: RemoteAudioSource[] = [];
    const previous = new Map(this.remoteAudio().map(source => [source.userId, source]));

    for (const participant of remotes) {
      const track = peers
        .get(participant.userId)
        ?.cameraStream.getAudioTracks()
        .find(t => t.readyState === 'live');
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

    this.state = stepActiveSpeaker(this.state, levels, now);
    if (this.state.current !== this.activeSpeakerId()) {
      this.activeSpeakerId.set(this.state.current);
    }
    const speaking = new Set(Object.keys(levels).filter(id => isSpeakingNow(this.state, id, now, DEFAULT_SPEAKER_OPTIONS)));
    if (!sameSet(this.speakingIds(), speaking)) {
      this.speakingIds.set(speaking);
      this.lastVoiceAt.set(this.state.lastVoiceAt);
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
    let sum = 0;
    for (const value of probe.buffer) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.sqrt(sum / probe.buffer.length);
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

function sameAudio(a: readonly RemoteAudioSource[], b: readonly RemoteAudioSource[]): boolean {
  return a.length === b.length && a.every((source, i) => source === b[i]);
}
