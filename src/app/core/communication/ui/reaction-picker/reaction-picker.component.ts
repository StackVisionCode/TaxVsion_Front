import { Component, ElementRef, input, output, viewChildren } from '@angular/core';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';

/**
 * F5 (D-50) — Picker curado de reacciones: chips `button` con el catálogo de la política.
 *
 *   @defer (when pickerOpen()) {
 *     <app-reaction-picker [catalog]="catalog()" (picked)="react($event)" (closed)="pickerOpen.set(false)" />
 *   }
 *
 * `role="dialog"` con `aria-label`, teclado (←/→/Home/End mueven el foco, Escape cierra), cierra al
 * elegir y al pulsar fuera (`appClickOutside`). Se posiciona encima del botón "React" (el padre lo
 * envuelve en un contenedor `relative`). Va en un chunk diferido: no entra al bundle inicial.
 */
@Component({
  selector: 'app-reaction-picker',
  imports: [ClickOutsideDirective],
  host: { class: 'absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2' },
  template: `
    <div role="dialog" aria-label="Pick a reaction" appClickOutside (appClickOutside)="closed.emit()" (keydown)="onKeydown($event)"
      class="flex max-w-[min(20rem,calc(100vw-2rem))] flex-wrap justify-center gap-1 rounded-2xl bg-gray-900/95 p-2 shadow-xl ring-1 ring-white/15 backdrop-blur-md">
      @for (emoji of catalog(); track emoji; let i = $index) {
        <button #chip type="button" (click)="pick(emoji)" [attr.aria-label]="'React with ' + emoji" [attr.tabindex]="i === 0 ? 0 : -1"
          class="flex h-10 w-10 items-center justify-center rounded-full text-2xl transition-transform hover:scale-110 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none">
          {{ emoji }}
        </button>
      }
    </div>
  `,
})
export class ReactionPickerComponent {
  readonly catalog = input.required<readonly string[]>();
  readonly picked = output<string>();
  readonly closed = output<void>();

  private readonly chips = viewChildren<ElementRef<HTMLButtonElement>>('chip');

  protected pick(emoji: string): void {
    this.picked.emit(emoji);
    this.closed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const chips = this.chips().map(c => c.nativeElement);
    if (!chips.length) {
      return;
    }
    const current = Math.max(0, chips.indexOf(document.activeElement as HTMLButtonElement));
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % chips.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + chips.length) % chips.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = chips.length - 1;
        break;
      case 'Escape':
        this.closed.emit();
        return;
      default:
        return;
    }
    event.preventDefault();
    chips[next].focus();
  }

  /** Foco al primer chip (lo llama el padre al abrir). */
  focusFirst(): void {
    this.chips()[0]?.nativeElement.focus();
  }
}
