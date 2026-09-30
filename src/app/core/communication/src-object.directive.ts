import { Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';

/**
 * Enlaza un `MediaStream` a la propiedad `srcObject` de un `<audio>`/`<video>`
 * (no es bindable en template). Como directiva funciona aunque el elemento se
 * cree/destruya con `*ngIf` — el setter corre con el valor actual al instanciarse.
 *
 * Además re-engancha el `srcObject` cuando cambia el SET de tracks del MISMO stream:
 * un track de video agregado tarde (p. ej. "subir a cámara" a mitad de llamada, o el
 * screenshare/nuevo productor en meetings) no siempre hace que un `<video>` ya montado
 * empiece a pintar. En `<audio>` solo se re-engancha si cambió el set de pistas de AUDIO (p. ej. la
 * pista remota llegó después de montar el elemento, típico en mesh/SFU): así un video que entra o
 * sale del mismo stream no corta el sonido.
 */
@Directive({
  selector: '[srcObject]',
  standalone: true,
})
export class SrcObjectDirective implements OnDestroy {
  private readonly el = inject(ElementRef<HTMLMediaElement>);
  private stream: MediaStream | null = null;
  /** Ids de las pistas de audio con las que se enganchó el `<audio>` por última vez. */
  private audioTrackIds = '';
  private readonly onTracksChanged = (): void => this.repoke();

  @Input() set srcObject(stream: MediaStream | null) {
    if (this.stream === stream) {
      return;
    }
    this.detach();
    this.stream = stream;
    if (stream) {
      stream.addEventListener('addtrack', this.onTracksChanged);
      stream.addEventListener('removetrack', this.onTracksChanged);
    }
    const media = this.el.nativeElement as HTMLMediaElement;
    this.audioTrackIds = this.currentAudioIds();
    if (media.srcObject !== stream) {
      media.srcObject = stream;
    }
  }

  ngOnDestroy(): void {
    this.detach();
  }

  private detach(): void {
    if (this.stream) {
      this.stream.removeEventListener('addtrack', this.onTracksChanged);
      this.stream.removeEventListener('removetrack', this.onTracksChanged);
    }
  }

  /** Fuerza al `<video>` a re-evaluar sus tracks (null→stream) cuando llega/ se va uno tarde. */
  private repoke(): void {
    const media = this.el.nativeElement as HTMLMediaElement;
    if (!this.stream) {
      return;
    }
    if (media.tagName === 'VIDEO') {
      media.srcObject = null;
      media.srcObject = this.stream;
      return;
    }
    const ids = this.currentAudioIds();
    if (media.tagName === 'AUDIO' && ids !== this.audioTrackIds) {
      this.audioTrackIds = ids;
      media.srcObject = null;
      media.srcObject = this.stream;
      void media.play?.()?.catch(() => undefined);
    }
  }

  private currentAudioIds(): string {
    return (this.stream?.getAudioTracks() ?? []).map(t => t.id).join(',');
  }
}
