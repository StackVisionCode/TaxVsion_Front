import { Directive, ElementRef, Input, inject } from '@angular/core';

/**
 * Enlaza un `MediaStream` a la propiedad `srcObject` de un `<audio>`/`<video>`
 * (no es bindable en template). Como directiva funciona aunque el elemento se
 * cree/destruya con `*ngIf` — el setter corre con el valor actual al instanciarse.
 */
@Directive({
  selector: '[srcObject]',
  standalone: true,
})
export class SrcObjectDirective {
  private readonly el = inject(ElementRef<HTMLMediaElement>);

  @Input() set srcObject(stream: MediaStream | null) {
    const media = this.el.nativeElement as HTMLMediaElement;
    if (media.srcObject !== stream) {
      media.srcObject = stream;
    }
  }
}
