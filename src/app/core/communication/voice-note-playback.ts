/**
 * Reproductor cross-browser de una nota de voz (F2). Framework-agnóstico: el bubble (F3/F4) crea una
 * instancia por nota, pasa un `onChange` (para disparar change-detection) y llama `toggle`/`seek`.
 *
 * Estrategia (probada en el CRM viejo, corrigiendo sus bugs):
 *   1. `<audio>` nativo con la fuente re-envuelta a su mime+codecs (los servidores devuelven
 *      `application/octet-stream`; sin `;codecs=opus` el `<audio>` ni intenta decodificar el webm).
 *   2. Si el nativo falla a decodificar (Safari con webm → error code 2/3), cae a Web Audio
 *      `AudioContext.decodeAudioData`, que sí decodifica opus, y reproduce por AudioBufferSourceNode.
 *   3. Duración: se muestra la del mensaje (hint) al instante; se corrige con la real cuando carga
 *      (guard `isFinite` contra el bug de `<audio>.duration = Infinity` en webm).
 *
 * Carga perezosa: no baja el audio hasta el primer play (una conversación puede tener muchas notas).
 */
export class VoiceNotePlayback {
  isPlaying = false;
  isLoading = false;
  hasError = false;
  currentTimeSec = 0;
  durationSec: number;

  private mode: 'idle' | 'native' | 'webaudio' = 'idle';
  private audioEl: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  // Web Audio
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private waStartedAt = 0; // ctx.currentTime en el último play
  private waOffsetSec = 0; // posición al pausar/seek
  private rafId: number | null = null;

  private loaded = false;
  private disposed = false;

  constructor(
    private readonly url: string,
    private readonly mimeType: string,
    durationHintMs: number,
    private readonly onChange: () => void,
  ) {
    this.durationSec = durationHintMs > 0 ? durationHintMs / 1000 : 0;
  }

  async toggle(): Promise<void> {
    if (this.disposed) return;
    if (this.isPlaying) {
      this.pause();
      return;
    }
    if (!this.loaded) {
      await this.load();
      if (this.hasError) return;
    }
    void this.play();
  }

  /** fraction 0..1 */
  seek(fraction: number): void {
    const f = Math.max(0, Math.min(1, fraction));
    const t = f * this.durationSec;
    if (this.mode === 'native' && this.audioEl) {
      this.audioEl.currentTime = t;
      this.currentTimeSec = t;
    } else if (this.mode === 'webaudio' && this.buffer) {
      const wasPlaying = this.isPlaying;
      this.stopWebAudioSource();
      this.waOffsetSec = t;
      this.currentTimeSec = t;
      if (wasPlaying) this.playWebAudio();
    }
    this.onChange();
  }

  dispose(): void {
    this.disposed = true;
    this.stopWebAudioSource();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
    }
    this.audioEl = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  // ---------- carga ----------

  private async load(): Promise<void> {
    this.isLoading = true;
    this.onChange();
    try {
      const resp = await fetch(this.url);
      const raw = await resp.blob();
      // Rewrap con codecs para que el <audio> nativo intente decodificar el webm.
      const type = this.playableType(raw.type || this.mimeType);
      const blob = new Blob([await raw.arrayBuffer()], { type });
      this.objectUrl = URL.createObjectURL(blob);
      this.audioEl = new Audio();
      this.audioEl.preload = 'metadata';
      this.audioEl.src = this.objectUrl;
      this.audioEl.addEventListener('loadedmetadata', () => {
        if (isFinite(this.audioEl!.duration) && this.audioEl!.duration > 0) {
          this.durationSec = this.audioEl!.duration;
          this.onChange();
        }
      });
      this.audioEl.addEventListener('timeupdate', () => {
        this.currentTimeSec = this.audioEl!.currentTime;
        this.onChange();
      });
      this.audioEl.addEventListener('ended', () => this.onEnded());
      this.audioEl.addEventListener('error', () => void this.onNativeError());
      this.mode = 'native';
      this.loaded = true;
    } catch {
      this.hasError = true;
    } finally {
      this.isLoading = false;
      this.onChange();
    }
  }

  private playableType(t: string): string {
    // El inspector de CloudStorage puede sniffear el webm/mp4 (solo-audio) como video/*; se fuerza el
    // mime de audio para que el <audio> nativo intente decodificarlo.
    const base = t.split(';')[0].toLowerCase();
    if (base === 'audio/mp4' || base === 'video/mp4') return 'audio/mp4';
    if (base === 'audio/webm' || base === 'video/webm' || base === '' || base === 'application/octet-stream') {
      return 'audio/webm;codecs=opus';
    }
    return t;
  }

  // ---------- native ----------

  private async play(): Promise<void> {
    if (this.mode === 'webaudio') {
      this.playWebAudio();
      return;
    }
    if (!this.audioEl) return;
    try {
      await this.audioEl.play();
      this.isPlaying = true;
      this.onChange();
    } catch {
      // Autoplay/decoding falló: intenta el fallback.
      await this.onNativeError();
    }
  }

  private pause(): void {
    if (this.mode === 'native' && this.audioEl) {
      this.audioEl.pause();
    } else if (this.mode === 'webaudio') {
      this.waOffsetSec = this.webAudioElapsed();
      this.stopWebAudioSource();
    }
    this.isPlaying = false;
    this.onChange();
  }

  private onEnded(): void {
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this.waOffsetSec = 0;
    this.onChange();
  }

  private async onNativeError(): Promise<void> {
    // Ya destruido: `dispose()` vacía `audioEl.src`, lo que dispara un evento `error`
    // (code 4) en una tarea posterior. Sin este guard, el fallback re-fetchea, decodifica
    // y ARRANCA la reproducción (`shouldPlay = isPlaying || !buffer` → true) — la nota se
    // reproducía sola al navegar de módulo o cerrar sesión.
    if (this.disposed) return;
    // Códigos 2 (network) y 3 (decode) = Safari no reproduce webm → Web Audio.
    const code = this.audioEl?.error?.code;
    if (this.mode === 'webaudio' || (code !== 2 && code !== 3 && code !== undefined)) {
      if (code === undefined) return; // error espurio sin código, ignora
    }
    const shouldPlay = this.isPlaying || !this.buffer;
    try {
      await this.initWebAudio();
      this.mode = 'webaudio';
      if (this.audioEl) this.audioEl.pause();
      if (shouldPlay) this.playWebAudio();
    } catch {
      this.hasError = true;
      this.isPlaying = false;
      this.onChange();
    }
  }

  // ---------- Web Audio fallback ----------

  private async initWebAudio(): Promise<void> {
    if (this.buffer) return;
    const resp = await fetch(this.url);
    const arrayBuffer = await resp.arrayBuffer();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = this.ctx ?? new Ctx();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    if (isFinite(this.buffer.duration) && this.buffer.duration > 0) {
      this.durationSec = this.buffer.duration; // fuente confiable de duración
    }
  }

  private playWebAudio(): void {
    if (!this.ctx || !this.buffer) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.stopWebAudioSource();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      // onended también dispara al hacer stop() manual; solo resetea si llegó al final.
      if (this.webAudioElapsed() >= this.durationSec - 0.05) this.onEnded();
    };
    source.start(0, this.waOffsetSec);
    this.source = source;
    this.waStartedAt = this.ctx.currentTime;
    this.isPlaying = true;
    this.trackWebAudioProgress();
    this.onChange();
  }

  private stopWebAudioSource(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* noop */
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private webAudioElapsed(): number {
    if (!this.ctx || !this.isPlaying) return this.waOffsetSec;
    return Math.min(this.durationSec, this.waOffsetSec + (this.ctx.currentTime - this.waStartedAt));
  }

  private trackWebAudioProgress(): void {
    const loop = (): void => {
      if (!this.isPlaying || this.mode !== 'webaudio') return;
      this.currentTimeSec = this.webAudioElapsed();
      this.onChange();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
}
