import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChildren } from '@angular/core';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';

/**
 * F5 (D-50) — Picker curado de reacciones: chips `button` con el catálogo de la política.
 *
 *   @defer (when pickerOpen()) {
 *     <app-reaction-picker [catalog]="catalog()" (picked)="react($event)" (closed)="pickerOpen.set(false)" />
 *   }
 *
 * `role="dialog"` con `aria-label`, teclado (←/→/Home/End mueven el foco, Escape cierra), cierra al
 * elegir y al pulsar fuera (`appClickOutside`). Va en un chunk diferido: no entra al bundle inicial.
 *
 * Se porta al `<body>` de su documento con `position: fixed` encima de `[anchor]` (el botón "React"):
 * la pastilla de controles tiene `overflow-x-auto`, que recorta cualquier panel absoluto que salga por
 * arriba (en producción quedaba oculto tras la pantalla compartida). Sin ancla visible (menú "More" en
 * pantallas chicas) se centra sobre la barra de controles.
 */
@Component({
  selector: 'app-reaction-picker',
  imports: [ClickOutsideDirective],
  host: {
    class: 'fixed z-[60]',
    '[style.top.px]': 'position()?.top ?? null',
    '[style.left.px]': 'position()?.left ?? null',
    '[style.visibility]': "position() ? null : 'hidden'",
  },
  template: `
    <div role="dialog" aria-label="Pick a reaction" appClickOutside [clickOutsideIgnore]="anchor()" (appClickOutside)="closed.emit()"
      (keydown)="onKeydown($event)"
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
  /** Botón que abre el picker: el panel se coloca encima, centrado. */
  readonly anchor = input<HTMLElement | null>(null);
  readonly picked = output<string>();
  readonly closed = output<void>();

  protected readonly position = signal<{ top: number; left: number } | null>(null);
  private readonly chips = viewChildren<ElementRef<HTMLButtonElement>>('chip');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly place = (): void => {
    const view = this.host.ownerDocument.defaultView;
    if (!view) return;
    const rect = this.anchor()?.getBoundingClientRect() ?? null;
    this.position.set(
      computePickerPosition(
        rect && rect.width > 0 ? rect : null,
        { width: this.host.offsetWidth, height: this.host.offsetHeight },
        { width: view.innerWidth, height: view.innerHeight },
      ),
    );
  };

  constructor() {
    afterNextRender(() => {
      // Su propio documento: en la ventana flotante (Document PiP) el body es otro.
      this.host.ownerDocument.body.appendChild(this.host);
      this.place();
      const view = this.host.ownerDocument.defaultView;
      view?.addEventListener('resize', this.place, { passive: true });
      view?.addEventListener('scroll', this.place, { capture: true, passive: true });
    });
    inject(DestroyRef).onDestroy(() => {
      const view = this.host.ownerDocument.defaultView;
      view?.removeEventListener('resize', this.place);
      view?.removeEventListener('scroll', this.place, { capture: true });
      this.host.remove(); // portado: si se destruye la sala con el picker abierto, Angular no lo quita
    });
  }

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

/** Separación con el botón, margen contra los bordes y altura reservada a la barra de controles. */
const GAP_PX = 8;
const EDGE_PX = 8;
const CONTROL_BAR_PX = 96;

/**
 * Encima del ancla y centrado con ella, siempre dentro de la ventana. Sin ancla, centrado sobre la
 * barra de controles. Pura para probarla sin layout.
 */
export function computePickerPosition(
  anchor: Pick<DOMRect, 'top' | 'left' | 'width'> | null,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const rawLeft = anchor ? anchor.left + anchor.width / 2 - panel.width / 2 : (viewport.width - panel.width) / 2;
  const rawTop = anchor ? anchor.top - GAP_PX - panel.height : viewport.height - CONTROL_BAR_PX - panel.height;
  return {
    top: clamp(rawTop, EDGE_PX, viewport.height - panel.height - EDGE_PX),
    left: clamp(rawLeft, EDGE_PX, viewport.width - panel.width - EDGE_PX),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
