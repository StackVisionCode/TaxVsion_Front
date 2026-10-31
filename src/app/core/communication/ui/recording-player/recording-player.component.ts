import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { BytesPipe } from '@shared/pipes/bytes.pipe';
import { toApiError } from '@core/models/api-error.model';
import { RecordingPlaybackService } from '../../recordings/recording-playback.service';
import {
  RecordingDetailsDto,
  RecordingScope,
  TranscriptSegment,
  activeSegmentIndex,
  filterTranscriptSegments,
  formatTranscriptTime,
  isPresignedUrlExpired,
  transcriptFailureMessage,
} from '../../recordings/recording-playback.model';
import { RecordingState, recordingFailureMessage } from '../../recording-status';

/** Reintentos seguidos de URL (vencida en plena reproducción) antes de rendirse. */
const MAX_URL_REFRESHES = 3;
/** Margen para no descargar con una URL a punto de vencer. */
const DOWNLOAD_URL_MARGIN_MS = 15_000;
const MS_PER_SECOND = 1000;

const STATE_TONES: Record<RecordingState, StatusTone> = {
  Idle: 'neutral',
  Requesting: 'warning',
  Recording: 'danger',
  Stopping: 'warning',
  Composing: 'info',
  Processing: 'info',
  Ready: 'success',
  Failed: 'danger',
};

const STATE_LABELS: Record<RecordingState, string> = {
  Idle: 'Not recorded',
  Requesting: 'Starting',
  Recording: 'Recording',
  Stopping: 'Stopping',
  Composing: 'Processing',
  Processing: 'Processing',
  Ready: 'Ready',
  Failed: 'Failed',
};

/**
 * F7 — Reproductor de una grabación (reunión o llamada) con su transcript. Compartido por la lista de
 * reuniones y el historial de llamadas del cliente (va dentro de `app-recording-viewer`, con @defer).
 *
 *   <app-recording-player scope="meeting" [targetId]="meetingId" />
 *
 * - Estado (Recording / Processing / Ready / Failed) desde `GET …/{id}/recording`.
 * - `<video>` con la URL presignada; si vence en plena reproducción (error de media) pide otra y
 *   retoma en el mismo `currentTime`. "Download" renueva la URL si está por vencer.
 * - Transcript JSON v2 (hablante + tiempo; clic = saltar a ese punto) con búsqueda; respaldo TXT.
 */
@Component({
  selector: 'app-recording-player',
  imports: [InfinityLoaderComponent, SearchInputComponent, StatusPillComponent, BytesPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './recording-player.component.html',
})
export class RecordingPlayerComponent {
  readonly scope = input.required<RecordingScope>();
  readonly targetId = input.required<string>();

  private readonly service = inject(RecordingPlaybackService);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('player');

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly details = signal<RecordingDetailsDto | null>(null);
  readonly playbackUrl = signal<string | null>(null);
  readonly playbackError = signal<string | null>(null);
  readonly transcriptLoading = signal(false);
  readonly segments = signal<TranscriptSegment[] | null>(null);
  readonly transcriptSource = signal<'json' | 'txt' | null>(null);
  readonly query = signal('');
  readonly currentMs = signal(0);
  readonly downloading = signal(false);

  readonly state = computed<RecordingState | null>(() => this.details()?.state ?? null);
  readonly stateLabel = computed(() => {
    const state = this.state();
    return state ? STATE_LABELS[state] : '';
  });
  readonly stateTone = computed<StatusTone>(() => {
    const state = this.state();
    return state ? STATE_TONES[state] : 'neutral';
  });
  readonly inProgress = computed(() => ['Requesting', 'Recording', 'Stopping'].includes(this.state() ?? ''));
  readonly processing = computed(() => this.state() === 'Composing' || this.state() === 'Processing');
  readonly failureMessage = computed(() => (this.state() === 'Failed' ? recordingFailureMessage(this.details()?.failureReason) : null));
  readonly durationLabel = computed(() => {
    const seconds = this.details()?.durationSeconds;
    return typeof seconds === 'number' && seconds > 0 ? formatTranscriptTime(seconds * MS_PER_SECOND) : null;
  });
  readonly transcript = computed(() => this.details()?.transcript ?? null);
  readonly transcriptFailure = computed(() => {
    const transcript = this.transcript();
    return transcript?.state === 'Failed' ? transcriptFailureMessage(transcript.failureReason) : null;
  });
  readonly filtered = computed(() => filterTranscriptSegments(this.segments() ?? [], this.query()));
  readonly activeSegment = computed(() => {
    const all = this.segments() ?? [];
    return all[activeSegmentIndex(all, this.currentMs())] ?? null;
  });

  private request: Subscription | null = null;
  private refreshAttempts = 0;
  private resumeAtSec: number | null = null;
  private resumePlaying = false;
  private playing = false;
  private loadSeq = 0;

  constructor() {
    effect(() => {
      const scope = this.scope();
      const id = this.targetId();
      untracked(() => this.load(scope, id));
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  /** Recarga todo (botón Retry / Refresh). */
  reload(): void {
    this.load(this.scope(), this.targetId());
  }

  formatTime(ms: number): string {
    return formatTranscriptTime(ms);
  }

  trackSegment(index: number, segment: TranscriptSegment): string {
    return `${segment.startMs}:${index}`;
  }

  /** Clic en una fila del transcript: saltar a ese punto y reproducir. */
  seek(segment: TranscriptSegment): void {
    const el = this.video()?.nativeElement;
    if (!el) {
      return;
    }
    el.currentTime = segment.startMs / MS_PER_SECOND;
    this.currentMs.set(segment.startMs);
    void el.play()?.catch(() => undefined);
  }

  onTimeUpdate(): void {
    const el = this.video()?.nativeElement;
    if (el) {
      this.currentMs.set(Math.floor(el.currentTime * MS_PER_SECOND));
    }
  }

  onPlay(): void {
    this.playing = true;
  }

  onPause(): void {
    this.playing = false;
  }

  /** Reproducción sana: se reinicia el contador de URLs renovadas. */
  onPlaying(): void {
    this.playing = true;
    this.refreshAttempts = 0;
    this.playbackError.set(null);
  }

  /** La URL presignada venció (o falló la red): pedir otra y retomar en el mismo punto. */
  onVideoError(): void {
    const el = this.video()?.nativeElement;
    if (!el || !this.details()?.playback) {
      return;
    }
    if (this.refreshAttempts >= MAX_URL_REFRESHES) {
      this.playbackError.set('The recording could not be played. Try again later.');
      return;
    }
    this.refreshAttempts++;
    this.resumeAtSec = el.currentTime || this.currentMs() / MS_PER_SECOND;
    this.resumePlaying = this.playing;
    this.request?.unsubscribe();
    this.request = this.service.getRecording(this.scope(), this.targetId()).subscribe({
      next: details => {
        this.details.set(details);
        this.playbackUrl.set(details.playback?.url ?? null);
      },
      error: () => this.playbackError.set('The recording could not be played. Try again later.'),
    });
  }

  /** Metadatos de la URL nueva: volver al punto donde estaba. */
  onLoadedMetadata(): void {
    const el = this.video()?.nativeElement;
    if (!el || this.resumeAtSec === null) {
      return;
    }
    el.currentTime = this.resumeAtSec;
    this.resumeAtSec = null;
    if (this.resumePlaying) {
      void el.play()?.catch(() => undefined);
    }
  }

  /** Descarga con la URL vigente (presignada con `attachment`); si vence pronto, pide otra antes. */
  download(): void {
    const playback = this.details()?.playback;
    if (!playback || this.downloading()) {
      return;
    }
    if (!isPresignedUrlExpired(playback, Date.now(), DOWNLOAD_URL_MARGIN_MS)) {
      triggerDownload(playback.url);
      return;
    }
    this.downloading.set(true);
    this.service.getRecording(this.scope(), this.targetId()).subscribe({
      next: details => {
        this.downloading.set(false);
        this.details.set(details);
        this.playbackUrl.set(details.playback?.url ?? null);
        if (details.playback) {
          triggerDownload(details.playback.url);
        }
      },
      error: () => {
        this.downloading.set(false);
        this.playbackError.set('The download link could not be created. Try again.');
      },
    });
  }

  private load(scope: RecordingScope, id: string): void {
    const seq = ++this.loadSeq;
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.playbackError.set(null);
    this.details.set(null);
    this.playbackUrl.set(null);
    this.segments.set(null);
    this.transcriptSource.set(null);
    this.query.set('');
    this.currentMs.set(0);
    this.refreshAttempts = 0;
    this.resumeAtSec = null;
    this.request = this.service.getRecording(scope, id).subscribe({
      next: details => {
        this.loading.set(false);
        this.details.set(details);
        this.playbackUrl.set(details.state === 'Ready' ? (details.playback?.url ?? null) : null);
        void this.loadTranscript(details, seq);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 404
            ? `There is no recording for this ${scope}.`
            : err instanceof HttpErrorResponse && err.status === 403
              ? "You don't have access to this recording."
              : toApiError(err).message,
        );
      },
    });
  }

  private async loadTranscript(details: RecordingDetailsDto, seq: number): Promise<void> {
    if (details.transcript?.state !== 'Ready') {
      return;
    }
    this.transcriptLoading.set(true);
    const loaded = await this.service.loadTranscript(details.transcript);
    if (seq !== this.loadSeq) {
      return;
    }
    this.transcriptLoading.set(false);
    this.segments.set(loaded?.segments ?? []);
    this.transcriptSource.set(loaded?.source ?? null);
  }
}

/** Ancla oculta: la URL trae `content-disposition: attachment`, no abre pestañas. */
function triggerDownload(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
