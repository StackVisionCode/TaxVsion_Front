import { Injectable } from '@angular/core';

/**
 * Captura de la grabación de una llamada (aislada del resto del motor). Mezcla el audio
 * local + remoto en UN solo track con WebAudio (MediaRecorder solo codifica el primer
 * audio track de un stream, así que sin mezclar solo se grabaría una voz) y lo graba con
 * MediaRecorder. Devuelve el Blob al parar; el que sube a CloudStorage es ActiveCallService.
 *
 * Alcance 2C-3: audio (alimenta el transcript del backend). El video en la grabación queda
 * como mejora futura (requiere compositar dos videos con canvas).
 */
@Injectable({ providedIn: 'root' })
export class CallRecordingService {
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  isSupported(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  /** Arranca la grabación de audio mezclado (local + N remotos). Devuelve false si no hay soporte/audio. */
  start(...streams: (MediaStream | null)[]): boolean {
    if (this.recorder || !this.isSupported()) {
      return false;
    }
    try {
      this.ctx = new AudioContext();
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
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      this.chunks = [];
      this.recorder = new MediaRecorder(new MediaStream([audioTrack]), { mimeType });
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

  /** Para la grabación y devuelve el Blob (o null si no estaba grabando). */
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
