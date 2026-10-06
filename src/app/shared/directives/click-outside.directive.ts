import { Directive, ElementRef, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';

/**
 * `[appClickOutside]`: emite `(appClickOutside)` cuando se pulsa fuera del host o se presiona Escape.
 *
 * Reemplaza el patrón repetido en las tablas/pickers de features
 * (`@HostListener('document:click')` + `target.closest('[data-dropdown="…"]')`), que exigía inventar
 * un `data-dropdown` único por instancia.
 *
 * Uso: `<div appClickOutside [clickOutsideEnabled]="open()" (appClickOutside)="open.set(false)">`
 *
 * - Escucha `pointerdown` (no `click`): se evalúa ANTES de que un clic interno desmonte su propio
 *   target (con `click`, un botón que se quita del DOM al pulsarse parecería estar "fuera").
 * - `clickOutsideEnabled` (default true): pásale el estado "abierto" para no emitir de más y no
 *   pisar el Escape de otros overlays (p. ej. un modal) cuando el menú está cerrado.
 * - Emite el `Event` original (PointerEvent o KeyboardEvent).
 */
@Directive({
  selector: '[appClickOutside]',
})
export class ClickOutsideDirective {
  @Input() clickOutsideEnabled = true;
  @Output() readonly appClickOutside = new EventEmitter<Event>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    if (!this.clickOutsideEnabled) {
      return;
    }
    const target = event.target as Node | null;
    if (target && this.host.contains(target)) {
      return;
    }
    this.appClickOutside.emit(event);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (this.clickOutsideEnabled) {
      this.appClickOutside.emit(event);
    }
  }
}
