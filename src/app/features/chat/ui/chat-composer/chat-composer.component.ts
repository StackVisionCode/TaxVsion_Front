import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnDestroy, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RecordedVoiceNote, VoiceNoteRecorderService } from '@core/communication/voice-note-recorder.service';

/**
 * Composer del Chat de equipo (estilo "Aether"): botón de adjuntar real
 * (dispara un `<input type="file">` oculto), input píldora y botón circular
 * negro de enviar. Al enviar texto, emite y limpia el borrador; el adjunto
 * se emite aparte y el padre decide cuándo terminó de subir (`uploading`).
 *
 * Nota de voz: con el input vacío el botón de enviar se vuelve micrófono; al pulsarlo el composer
 * se transforma en "grabando" (punto rojo + timer + nivel en vivo) con cancelar/enviar.
 */
@Component({
  selector: 'app-chat-composer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-composer.component.html',
})
export class ChatComposerComponent implements OnDestroy {
  @Input() uploading = false;
  @Output() send = new EventEmitter<string>();
  @Output() attach = new EventEmitter<File>();
  /** true en cada pulsación con texto, false al enviar o vaciar/blur. El padre lo throttlea al socket. */
  @Output() typing = new EventEmitter<boolean>();
  /** Nota de voz grabada lista para subir. */
  @Output() sendVoiceNote = new EventEmitter<RecordedVoiceNote>();
  /** true al empezar a grabar, false al parar/cancelar/enviar — para el indicador "grabando…". */
  @Output() recording = new EventEmitter<boolean>();

  readonly recorder = inject(VoiceNoteRecorderService);
  readonly draft = signal('');
  /** Con texto se muestra enviar; sin texto, micrófono (patrón WhatsApp). */
  readonly hasText = computed(() => this.draft().trim().length > 0);

  onDraftChange(value: string): void {
    this.draft.set(value);
    this.typing.emit(value.trim().length > 0);
  }

  onBlur(): void {
    this.typing.emit(false);
  }

  submit(): void {
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
    this.typing.emit(false);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.attach.emit(file);
    }
    input.value = '';
  }

  // ---------- Nota de voz ----------

  async startRecording(): Promise<void> {
    if (this.uploading || this.recorder.isRecording()) return;
    const ok = await this.recorder.start();
    if (ok) this.recording.emit(true);
  }

  cancelRecording(): void {
    this.recorder.cancel();
    this.recording.emit(false);
  }

  async stopAndSend(): Promise<void> {
    this.recording.emit(false);
    const recorded = await this.recorder.stop();
    if (recorded) this.sendVoiceNote.emit(recorded);
  }

  /** mm:ss del timer de grabación. */
  elapsedLabel(): string {
    const s = Math.floor(this.recorder.elapsedMs() / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    // Si el hilo se desmonta a mitad de grabación (cambio de conversación), corta el micrófono y avisa.
    if (this.recorder.isRecording()) {
      this.recorder.cancel();
      this.recording.emit(false);
    }
  }
}
