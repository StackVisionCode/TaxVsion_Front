import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  Input,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { VoiceNotePlayback } from '@core/communication/voice-note-playback';

/**
 * Player de una nota de voz dentro de una burbuja del chat. Encapsula {@link VoiceNotePlayback}
 * (nativo + fallback Web Audio) y dibuja la onda real. Los colores se adaptan a `mine` (sobre la
 * burbuja brand-bold = blanco) vs recibido (tarjeta blanca = índigo). Resuelve la URL presignada al
 * primer play (carga perezosa) — un chat con muchas notas no baja audios hasta que se reproducen.
 */
@Component({
  selector: 'app-voice-note-player',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './voice-note-player.component.html',
})
export class VoiceNotePlayerComponent implements OnDestroy {
  @Input({ required: true }) fileId!: string;
  @Input() durationMs = 0;
  @Input() set waveform(peaks: number[] | null | undefined) {
    // Normaliza a alturas 15-100% (una barra a 0 no se ve). Sin picos → onda plana decorativa.
    const src = peaks && peaks.length ? peaks : new Array(24).fill(30);
    this.bars = src.map((p) => 15 + Math.round((Math.max(0, Math.min(100, p)) / 100) * 85));
  }
  @Input() mine = false;

  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  bars: number[] = new Array(24).fill(30);
  playback: VoiceNotePlayback | null = null;
  loading = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.playback?.dispose());
  }

  ngOnDestroy(): void {
    this.playback?.dispose();
  }

  get progress(): number {
    const p = this.playback;
    if (!p || p.durationSec <= 0) return 0;
    return Math.max(0, Math.min(1, p.currentTimeSec / p.durationSec));
  }

  get label(): string {
    const p = this.playback;
    const totalSec = p && p.durationSec > 0 ? p.durationSec : this.durationMs / 1000;
    const showSec = p?.isPlaying ? p.currentTimeSec : totalSec;
    return this.mmss(showSec);
  }

  async toggle(): Promise<void> {
    if (!this.playback) {
      this.loading = true;
      try {
        const res = await firstValueFrom(this.cloudStorage.getDownloadUrl(this.fileId));
        this.playback = new VoiceNotePlayback(res.downloadUrl, '', this.durationMs, () =>
          this.cdr.markForCheck(),
        );
      } catch {
        this.loading = false;
        return;
      }
      this.loading = false;
    }
    await this.playback.toggle();
    this.cdr.markForCheck();
  }

  seek(event: MouseEvent): void {
    if (!this.playback) return;
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.playback.seek((event.clientX - rect.left) / rect.width);
  }

  private mmss(totalSec: number): string {
    const s = Math.max(0, Math.round(totalSec));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
}
