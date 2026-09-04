import { Injectable, signal } from '@angular/core';

/** Resultado de una grabación lista para subir. */
export interface RecordedVoiceNote {
  readonly blob: Blob;
  /** Content-type base SIN el `;codecs=...` — es lo que se declara al subir (MinIO liga el content-type). */
  readonly mimeType: string;
  readonly durationMs: number;
  /** Picos 0-100 (reamostreados a un tamaño fijo) para dibujar la onda. */
  readonly waveform: number[];
}

/** Nº de barras persistidas de la onda (coincide con el cap del backend, 128). */
const WAVEFORM_BARS = 48;
const MAX_DURATION_MS = 300_000; // 5 min
const MIN_DURATION_MS = 1_000; // 1 s

/**
 * Grabador de notas de voz (F2). Solo lógica + señales de estado; la UI (timer, barras, botones) la
 * pone el composer (F3/F4) leyendo estas señales. Usa APIs nativas — sin librerías.
 *
 * Cross-browser: el mimeType se detecta (mp4/AAC nativo en Safari, webm/opus en Chrome/Firefox) y se
 * DEVUELVE el real, así el uploader declara exactamente lo que sube. La reproducción se resuelve aparte
 * (voice-note-playback.ts) con fallback a Web Audio.
 */
@Injectable({ providedIn: 'root' })
export class VoiceNoteRecorderService {
  /** true mientras hay una grabación en curso (incluye pausa). */
  readonly isRecording = signal(false);
  readonly isPaused = signal(false);
  /** Duración transcurrida (ms), sin contar el tiempo en pausa. */
  readonly elapsedMs = signal(0);
  /** Nivel de audio 0-100 en vivo (para la animación de barras mientras se graba). */
  readonly level = signal(0);

  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = 'audio/webm';
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private rafId: number | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private peaks: number[] = [];
  private lastPeakAt = 0;
  private startedAt = 0;
  private pausedAccumMs = 0;
  private pauseStartedAt = 0;

  get isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  /** Empieza a grabar. Devuelve false si no hay permiso de micrófono o no está soportado. */
  async start(): Promise<boolean> {
    if (this.isRecording()) return true;
    if (!this.isSupported) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return false;
    }
    this.mimeType = this.pickMimeType();
    this.chunks = [];
    this.peaks = [];
    this.lastPeakAt = 0;
    try {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    } catch {
      // Algún navegador rechaza el mimeType elegido: reintenta sin opciones (usa su default).
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mimeType = this.mediaRecorder.mimeType || 'audio/webm';
    }
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
    this.setupAnalyser(this.stream);
    this.startedAt = Date.now();
    this.pausedAccumMs = 0;
    this.isRecording.set(true);
    this.isPaused.set(false);
    this.elapsedMs.set(0);
    this.level.set(0);
    this.tickTimer = setInterval(() => {
      const ms = this.currentDurationMs();
      this.elapsedMs.set(ms);
      if (ms >= MAX_DURATION_MS && this.mediaRecorder?.state !== 'inactive') {
        // Tope de 5 min: el caller decide (normalmente auto-enviar). Se deja la grabación finalizada.
        this.mediaRecorder?.requestData();
      }
    }, 200);
    return true;
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused.set(true);
      this.pauseStartedAt = Date.now();
    }
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') {
      this.pausedAccumMs += Date.now() - this.pauseStartedAt;
      this.mediaRecorder.resume();
      this.isPaused.set(false);
    }
  }

  /**
   * Detiene y devuelve la nota lista para subir, o null si duró menos de 1s (se descarta).
   * Siempre libera el micrófono.
   */
  async stop(): Promise<RecordedVoiceNote | null> {
    if (!this.mediaRecorder) {
      this.teardown();
      return null;
    }
    const durationMs = this.currentDurationMs();
    const mimeBase = this.mimeType.split(';')[0];
    const blob = await this.finalizeBlob(mimeBase);
    const waveform = this.buildWaveform();
    this.teardown();
    if (durationMs < MIN_DURATION_MS) return null;
    return { blob, mimeType: mimeBase, durationMs, waveform };
  }

  /** Cancela y descarta: libera el micrófono sin producir nota. */
  cancel(): void {
    this.teardown();
  }

  // ---------- internos ----------

  private pickMimeType(): string {
    // Safari no graba webm: si webm no está soportado pero mp4 sí, se prefiere mp4 (nativo, reproduce
    // en todos). En Chrome/Firefox webm/opus es lo natural. (El CRM viejo tenía el orden invertido y
    // nunca elegía mp4 en Safari — ver plan.)
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
      if (!MediaRecorder.isTypeSupported('audio/webm') && MediaRecorder.isTypeSupported('audio/mp4')) {
        return 'audio/mp4';
      }
      for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
        if (MediaRecorder.isTypeSupported(t)) return t;
      }
    }
    return 'audio/webm';
  }

  private setupAnalyser(stream: MediaStream): void {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new Ctx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyser);
      const buffer = new Uint8Array(this.analyser.frequencyBinCount);
      const loop = (): void => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(buffer);
        // Pico absoluto respecto al centro (128) → 0-100.
        let peak = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = Math.abs(buffer[i] - 128);
          if (v > peak) peak = v;
        }
        const level = Math.min(100, Math.round((peak / 128) * 100));
        if (!this.isPaused()) {
          this.level.set(level);
          const now = Date.now();
          if (now - this.lastPeakAt >= 100) {
            this.lastPeakAt = now;
            this.peaks.push(level);
          }
        }
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    } catch {
      // Sin AnalyserNode la onda queda plana; no rompe la grabación.
    }
  }

  private currentDurationMs(): number {
    if (this.startedAt === 0) return 0;
    const extraPause = this.isPaused() ? Date.now() - this.pauseStartedAt : 0;
    return Math.max(0, Date.now() - this.startedAt - this.pausedAccumMs - extraPause);
  }

  private finalizeBlob(mimeBase: string): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: mimeBase }));
        return;
      }
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: mimeBase }));
      recorder.stop();
    });
  }

  /** Reamostrea los picos acumulados a un tamaño fijo (promedio por bucket); [] si no hubo captura. */
  private buildWaveform(): number[] {
    const src = this.peaks;
    if (src.length === 0) return [];
    if (src.length <= WAVEFORM_BARS) return src.slice();
    const out: number[] = [];
    const bucket = src.length / WAVEFORM_BARS;
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      const from = Math.floor(i * bucket);
      const to = Math.floor((i + 1) * bucket);
      let sum = 0;
      let n = 0;
      for (let j = from; j < to; j++) {
        sum += src[j];
        n++;
      }
      out.push(n > 0 ? Math.round(sum / n) : 0);
    }
    return out;
  }

  private teardown(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
    try {
      this.sourceNode?.disconnect();
    } catch {
      /* noop */
    }
    this.sourceNode = null;
    this.analyser = null;
    if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close();
    this.audioContext = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        /* noop */
      }
    }
    this.mediaRecorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.startedAt = 0;
    this.isRecording.set(false);
    this.isPaused.set(false);
    this.level.set(0);
  }
}
