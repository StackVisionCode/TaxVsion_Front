import { computed, signal } from '@angular/core';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { MS_PER_SECOND, formatRecordingElapsed } from './meeting-clock.util';

/**
 * F7 — Estado de una grabación (reunión o llamada) tal como lo emite el servidor, compartido por
 * `ActiveMeetingService` y `ActiveCallService`. Funciones puras (copy de avisos y errores) + el reloj
 * del badge REC, que cuenta contra el reloj del SERVIDOR (`startedAtUtc` + desfase del socket).
 */

export type RecordingState = 'Idle' | 'Requesting' | 'Recording' | 'Stopping' | 'Composing' | 'Processing' | 'Ready' | 'Failed';

/** `Server` = el recorder captura del SFU; `Client` = mezcla en el navegador (fallback con flag, C-03). */
export type RecordingCaptureMode = 'Server' | 'Client';

/** Motivo del `Stopping`. */
export type RecordingStopReason = 'User' | 'LimitReached' | 'MeetingEnded' | 'CallEnded';

/** Campos comunes de `meeting.recording.state_changed` / `call.recording.state_changed`. */
export interface RecordingStateChange {
  state: RecordingState;
  updatedAtUtc: string;
  /** Ausente en backends previos a F7 → se trata como `Client`. */
  captureMode?: RecordingCaptureMode;
  startedAtUtc?: string | null;
  maxDurationSeconds?: number | null;
  /** En `Stopping`: `RecordingStopReason`; en `Failed`: código del fallo. */
  reason?: string | null;
}

/** Campos comunes de `*.recording.limit_warning`. */
export interface RecordingLimitWarning {
  remainingSeconds: number;
  stopsAtUtc: string;
}

/** La grabación usa la captura del navegador (mezcla + subida + attach): solo con `Client` o sin el campo. */
export function usesClientCapture(change: Pick<RecordingStateChange, 'captureMode'>): boolean {
  return change.captureMode !== 'Server';
}

/** Ya terminó de grabar y el servidor la está componiendo o procesando. */
export function isRecordingProcessing(state: RecordingState): boolean {
  return state === 'Composing' || state === 'Processing';
}

/** Estados en los que el botón de grabar queda deshabilitado (hay una transición en curso). */
export function isRecordingBusy(state: RecordingState): boolean {
  return state === 'Requesting' || state === 'Stopping' || isRecordingProcessing(state);
}

/** "Recording stops in 5 min." (mínimo 1 min). */
export function recordingLimitWarningMessage(remainingSeconds: number): string {
  const minutes = Math.max(1, Math.round(remainingSeconds / 60));
  return `Recording stops in ${minutes} min.`;
}

/** Copy legible del código de `Failed` (recorder, composición, CloudStorage). */
export function recordingFailureMessage(code: string | null | undefined): string {
  switch (code) {
    case 'RecorderUnavailable':
    case 'CapacityExceeded':
    case 'Recording.CapacityExceeded':
      return 'The recording service is unavailable. Try again later.';
    case 'StorageRejected':
      return 'The recording could not be saved (storage limit).';
    case 'Infected':
      return 'The recording was blocked by the security scan.';
    case 'Blocked':
    case 'BlockedByPolicy':
      return "The recording was blocked by your office's file policy.";
    case 'ScanFailed':
      return 'The recording could not be verified. Try again later.';
    case 'NoTracks':
      return 'Nothing was recorded: no audio or video reached the recorder.';
    case 'RecorderLost':
    case 'RecorderRestarted':
    case 'ComposeError':
    case 'UploadFailed':
      return 'The recording could not be processed.';
    case 'Aborted':
      return 'The recording was cancelled.';
    default:
      return 'The recording failed.';
  }
}

/** Copy de los acks de `*.recording.start_request`; null = no es un código conocido. */
export function recordingStartErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case 'Plan.RecordingDisabled':
      return "Recording isn't included in your plan.";
    case 'Meeting.RecordingRequiresSfu':
      return "This meeting can't be recorded. Start a new meeting to record.";
    default:
      return null;
  }
}

/** Aviso que acompaña un cambio de estado (null = silencioso). */
export interface RecordingStateNotice {
  tone: 'info' | 'error';
  message: string;
}

/** `Stopping` por límite → info; `Failed` → error con su copy; el resto (incluido el stop manual) en silencio. */
export function recordingStateNotice(change: Pick<RecordingStateChange, 'state' | 'reason'>): RecordingStateNotice | null {
  if (change.state === 'Stopping' && change.reason === 'LimitReached') {
    return { tone: 'info', message: 'Recording stopped (time limit reached).' };
  }
  if (change.state === 'Failed') {
    return { tone: 'error', message: recordingFailureMessage(change.reason) };
  }
  return null;
}

/**
 * Reloj del badge REC. Con `startedAtUtc` cuenta contra el reloj del servidor (`Date.now() + offset`);
 * sin él (backend viejo), desde que llegó el `Recording`. Con `maxDurationSeconds` también da el restante.
 * `start` tolera reentradas (el evento `Recording` puede repetirse); `stop` lo deja en cero.
 */
export class RecordingClock {
  readonly startedAtUtc = signal<string | null>(null);
  readonly maxDurationSeconds = signal<number | null>(null);
  private readonly nowMs = signal(Date.now());
  private readonly localStartMs = signal<number | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly offsetMs: () => number,
    private readonly tickMs: number,
  ) {}

  readonly running = computed(() => this.localStartMs() !== null);

  readonly elapsedMs = computed(() => {
    const local = this.localStartMs();
    if (local === null) {
      return 0;
    }
    const now = this.nowMs();
    const startedAt = this.startedAtUtc();
    const started = startedAt ? parseUtcDate(startedAt).getTime() : Number.NaN;
    return Math.max(0, Number.isNaN(started) ? now - local : now + this.offsetMs() - started);
  });

  /** Segundos que quedan hasta el tope; null sin tope. */
  readonly remainingSeconds = computed(() => {
    const max = this.maxDurationSeconds();
    if (max === null || max <= 0 || !this.running()) {
      return null;
    }
    return Math.max(0, max - Math.floor(this.elapsedMs() / MS_PER_SECOND));
  });

  readonly elapsedLabel = computed(() => formatRecordingElapsed(this.elapsedMs()));
  /** "4:37" restante; null sin tope. */
  readonly remainingLabel = computed(() => {
    const remaining = this.remainingSeconds();
    return remaining === null ? null : formatRecordingElapsed(remaining * MS_PER_SECOND);
  });

  start(startedAtUtc?: string | null, maxDurationSeconds?: number | null): void {
    if (startedAtUtc !== undefined) {
      this.startedAtUtc.set(startedAtUtc);
    }
    if (maxDurationSeconds !== undefined) {
      this.maxDurationSeconds.set(maxDurationSeconds);
    }
    this.nowMs.set(Date.now());
    if (this.timer) {
      return;
    }
    this.localStartMs.set(Date.now());
    this.timer = setInterval(() => this.nowMs.set(Date.now()), this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.localStartMs.set(null);
    this.startedAtUtc.set(null);
    this.maxDurationSeconds.set(null);
  }
}
