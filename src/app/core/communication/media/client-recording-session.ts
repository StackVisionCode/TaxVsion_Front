import { Injectable, inject } from '@angular/core';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest } from '@core/cloud-storage/cloud-storage.model';

const BITS_PER_KBIT = 1000;

/**
 * F4 (C-03) — Grabación en el cliente de UNA sesión (llamada o reunión): mezcla el audio local + N
 * remotos con WebAudio en una sola pista (MediaRecorder solo codifica la primera pista de audio) y la
 * graba con MediaRecorder. Devuelve el Blob al parar; subirlo es cosa de `RecordingUploadService`.
 * Alcance: audio (alimenta el transcript). El video queda como mejora futura.
 */
export class ClientRecordingSession {
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  static isSupported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  get active(): boolean {
    return !!this.recorder;
  }

  /**
   * Arranca la mezcla (local + remotos) a `audioKbps` (`policy.audio.clientRecordingKbps`, C-03).
   * Devuelve false si no hay soporte o ninguna pista de audio.
   */
  async start(streams: readonly (MediaStream | null)[], audioKbps: number): Promise<boolean> {
    if (this.recorder || !ClientRecordingSession.isSupported()) {
      return false;
    }
    try {
      this.ctx = new AudioContext();
      // Sin gesto previo el contexto puede nacer suspendido: la grabación salía vacía.
      await this.ctx.resume().catch(() => undefined);
      const dest = this.ctx.createMediaStreamDestination();
      let mixed = 0;
      for (const stream of streams) {
        const track = stream?.getAudioTracks()[0];
        if (track) {
          this.ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
          mixed++;
        }
      }
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (mixed === 0 || !audioTrack) {
        this.cleanup();
        return false;
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.chunks = [];
      this.recorder = new MediaRecorder(new MediaStream([audioTrack]), {
        mimeType,
        audioBitsPerSecond: audioKbps * BITS_PER_KBIT,
      });
      this.recorder.ondataavailable = e => {
        if (e.data.size) {
          this.chunks.push(e.data);
        }
      };
      this.recorder.start();
      return true;
    } catch {
      this.cleanup();
      return false;
    }
  }

  /** Para y devuelve el Blob (null si no estaba grabando). */
  async stop(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) {
      return null;
    }
    const blob = await new Promise<Blob>(resolve => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: 'audio/webm' }));
      try {
        rec.stop();
      } catch {
        resolve(new Blob(this.chunks, { type: 'audio/webm' }));
      }
    });
    this.cleanup();
    return blob;
  }

  private cleanup(): void {
    this.recorder = null;
    this.chunks = [];
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/**
 * Subida + vínculo de una grabación, común a llamadas y reuniones: sube el audio a CloudStorage
 * (carpeta Recordings) y luego llama a `attach` (socket) con un reintento. Si la subida falla se avisa;
 * si solo falla el attach NO (el archivo ya existe y se puede reconciliar aparte).
 */
@Injectable({ providedIn: 'root' })
export class RecordingUploadService {
  private readonly cloudStorage = inject(CloudStorageUploadService);
  private readonly toast = inject(ToastService);

  async uploadAndAttach(ownerId: string, filePrefix: string, blob: Blob, attach: (fileId: string) => Promise<unknown>): Promise<void> {
    if (blob.size === 0) {
      return;
    }
    const file = new File([blob], `${filePrefix}-${ownerId}.webm`, { type: 'audio/webm' });
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: 'audio/webm',
      sizeBytes: file.size,
      ownerType: 'Communication',
      ownerId,
      // RecordingsPolicy acepta audio/webm; OtherPolicy no (devolvía 400).
      folderType: 'Recordings',
      taxYear: null,
    };
    let fileId: string;
    try {
      fileId = await firstValueFrom(
        this.cloudStorage.initiateUpload(request).pipe(
          switchMap(init =>
            this.cloudStorage.uploadToPresignedUrl(init.uploadUrl, init.formData, file).pipe(
              switchMap(() => this.cloudStorage.completeUpload(init.fileId)),
              map(() => init.fileId),
            ),
          ),
        ),
      );
    } catch {
      this.toast.error('Could not save the recording.');
      return;
    }
    try {
      await attach(fileId);
    } catch {
      try {
        await attach(fileId);
      } catch {
        /* la grabación quedó guardada; solo faltó el vínculo */
      }
    }
  }
}
