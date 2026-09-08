import { Directive, ElementRef, Input, OnDestroy, inject } from '@angular/core';

/**
 * Enlaza un `MediaStream` a la propiedad `srcObject` de un `<audio>`/`<video>`
 * (no es bindable en template). Como directiva funciona aunque el elemento se
 * cree/destruya con `*ngIf` — el setter corre con el valor actual al instanciarse.
 *
 * Además re-engancha el `srcObject` cuando cambia el SET de tracks del MISMO stream:
 * un track de video agregado tarde (p. ej. "subir a cámara" a mitad de llamada, o el
 * screenshare/nuevo productor en meetings) no siempre hace que un `<video>` ya montado
 * empiece a pintar. Se limita a `<video>` para no cortar el audio de un `<audio>`.
 */
@Directive({
  selector: '[srcObject]',
  standalone: true,
})
export class SrcObjectDirective implements OnDestroy {
  private readonly el = inject(ElementRef<HTMLMediaElement>);
  private stream: MediaStream | null = null;
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
    if (media.tagName === 'VIDEO' && this.stream) {
      media.srcObject = null;
      media.srcObject = this.stream;
    }
  }
}
