import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { portalToBody } from '../../utils/overlay.util';
import { prefersReducedMotion } from '../../utils/reduced-motion.util';

export type TooltipPlacement = 'top' | 'bottom';

export interface TooltipPosition {
  top: number;
  left: number;
  placement: TooltipPlacement;
}

/** Separación con el ancla y margen mínimo contra los bordes de la ventana. */
const GAP_PX = 6;
const EDGE_PX = 8;
/** Tras un toque, el mouseenter sintético no debe abrir el tooltip. */
const TOUCH_GRACE_MS = 700;

let nextTooltipId = 0;

/**
 * Posición del tooltip: en la colocación pedida si cabe; si no, la opuesta (flip). Centrado sobre el
 * ancla y siempre dentro de la ventana. Pura para probarla sin layout.
 */
export function computeTooltipPosition(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: TooltipPlacement = 'top',
): TooltipPosition {
  const fitsAbove = anchor.top - GAP_PX - tip.height >= EDGE_PX;
  const fitsBelow = anchor.bottom + GAP_PX + tip.height <= viewport.height - EDGE_PX;
  let placement = preferred;
  if (preferred === 'top' && !fitsAbove && fitsBelow) placement = 'bottom';
  if (preferred === 'bottom' && !fitsBelow && fitsAbove) placement = 'top';

  const top = placement === 'top' ? anchor.top - GAP_PX - tip.height : anchor.bottom + GAP_PX;
  const rawLeft = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(EDGE_PX, Math.min(rawLeft, viewport.width - tip.width - EDGE_PX));
  return { top: Math.max(EDGE_PX, top), left, placement };
}

/**
 * Tooltip ligero: `<button appTooltip="Pin note" aria-label="Pin note">…</button>`.
 *
 * - Aparece al pasar el ratón y con el foco de teclado (`:focus-visible`) tras `appTooltipDelay`
 *   (300 ms); se oculta al salir, al perder el foco, con Escape, al pulsar y al hacer scroll.
 * - Se porta al `<body>` con `position: fixed` (`portalToBody`), así que ningún `overflow` lo
 *   recorta; arriba por defecto y hace flip abajo si no cabe (`appTooltipPlacement="bottom"`).
 * - `role="tooltip"` + `aria-describedby` en el anfitrión mientras está visible.
 * - Texto vacío o `appTooltipDisabled` = no hace nada. Sin animación con reduced-motion.
 */
@Directive({
  selector: '[appTooltip]',
  host: {
    '(mouseenter)': 'onPointerEnter()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'onFocus()',
    '(focusout)': 'hide()',
    '(touchstart)': 'onTouch()',
    '(mousedown)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class TooltipDirective implements OnDestroy {
  readonly text = input<string | null | undefined>('', { alias: 'appTooltip' });
  readonly placement = input<TooltipPlacement>('top', { alias: 'appTooltipPlacement' });
  readonly delay = input(300, { alias: 'appTooltipDelay' });
  readonly disabled = input(false, { alias: 'appTooltipDisabled' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly id = `app-tooltip-${nextTooltipId++}`;
  private tip: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTouch = 0;
  private readonly onScroll = (): void => this.hide();

  constructor() {
    // Texto que cambia con el tooltip abierto (Pin → Unpin): se actualiza o se cierra.
    effect(() => {
      const text = this.text();
      if (!this.tip) return;
      if (!text || this.disabled()) {
        this.hide();
      } else {
        this.tip.textContent = text;
        this.place();
      }
    });
  }

  onPointerEnter(): void {
    if (Date.now() - this.lastTouch < TOUCH_GRACE_MS) return;
    this.schedule();
  }

  onFocus(): void {
    // Solo foco de teclado: el foco que deja un clic no debe abrirlo.
    if (matchesFocusVisible(this.host.nativeElement)) this.schedule();
  }

  onTouch(): void {
    this.lastTouch = Date.now();
    this.hide();
  }

  hide(): void {
    this.clearTimer();
    if (!this.tip) return;
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    this.tip.remove();
    this.tip = null;
    this.setDescribedBy(false);
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private schedule(): void {
    if (!this.text() || this.disabled() || this.tip) return;
    this.clearTimer();
    this.timer = setTimeout(() => this.show(), Math.max(0, this.delay()));
  }

  private show(): void {
    this.timer = null;
    const text = this.text();
    if (!text || this.disabled() || this.tip || !this.host.nativeElement.isConnected) return;

    const tip = document.createElement('div');
    tip.id = this.id;
    tip.setAttribute('role', 'tooltip');
    tip.className =
      'pointer-events-none fixed z-[95] max-w-[16rem] rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium leading-snug text-white shadow-lg';
    tip.textContent = text;
    tip.style.top = '0px';
    tip.style.left = '0px';
    this.tip = portalToBody(tip);
    this.place();
    this.setDescribedBy(true);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });

    if (!prefersReducedMotion() && typeof tip.animate === 'function') {
      const dy = tip.dataset['placement'] === 'bottom' ? -2 : 2;
      tip.animate(
        [
          { opacity: 0, transform: `translateY(${dy}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 120, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
      );
    }
  }

  private place(): void {
    const tip = this.tip;
    if (!tip) return;
    const position = computeTooltipPosition(
      this.host.nativeElement.getBoundingClientRect(),
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      this.placement(),
    );
    tip.style.top = `${position.top}px`;
    tip.style.left = `${position.left}px`;
    tip.dataset['placement'] = position.placement;
  }

  /** Añade/quita el id sin pisar otros `aria-describedby` del anfitrión. */
  private setDescribedBy(on: boolean): void {
    const el = this.host.nativeElement;
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.id);
    if (on) ids.push(this.id);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** `:focus-visible` con degradado: si el motor no lo soporta, cualquier foco cuenta. */
function matchesFocusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}
