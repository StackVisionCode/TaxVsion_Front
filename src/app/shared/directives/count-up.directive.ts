import { Directive, ElementRef, Input, NgZone, OnChanges, OnDestroy, inject } from '@angular/core';

/** Formatea el número mostrado: entero con separador de miles (satisface ver "1,240" subir). */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Anima el número de un elemento desde su valor anterior hasta el nuevo (count-up), con easing y un
 * "pop" breve en cada incremento — pensado para los contadores del import (Created/Updated/…), que
 * cambian entre sondeos y merecen leerse subiendo en vez de saltar. Escribe `textContent` fuera de la
 * zona de Angular (sin disparar change detection) y se cancela solo al llegar un valor nuevo.
 *
 * Accesibilidad: con `prefers-reduced-motion: reduce` fija el valor al instante, sin animar ni hacer
 * pop. El texto final es siempre el número real, así que nada depende de la animación para leerse.
 */
@Directive({
  selector: '[appCountUp]',
})
export class CountUpDirective implements OnChanges, OnDestroy {
  @Input('appCountUp') value = 0;
  /** Duración del conteo en ms. */
  @Input() countUpDuration = 700;

  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly zone = inject(NgZone);

  private displayed = 0;
  private rafId = 0;
  private started = false;

  ngOnChanges(): void {
    const target = Math.round(this.value || 0);

    // Primer render: arranca desde 0 (revela subiendo). Cambios posteriores: desde lo mostrado.
    const from = this.started ? this.displayed : 0;
    this.started = true;

    if (target === from) {
      this.render(target);
      return;
    }

    if (prefersReducedMotion() || this.countUpDuration <= 0) {
      this.render(target);
      return;
    }

    this.animate(from, target);
    // Pop solo cuando el número sube (no al bajar por un reset).
    if (target > from) {
      this.pop();
    }
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  private animate(from: number, to: number): void {
    this.cancel();
    const duration = this.countUpDuration;
    this.zone.runOutsideAngular(() => {
      const start = performance.now();
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - start) / duration);
        const current = from + (to - from) * easeOutCubic(progress);
        this.render(current);
        if (progress < 1) {
          this.rafId = requestAnimationFrame(tick);
        } else {
          this.displayed = to;
          this.rafId = 0;
        }
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  private pop(): void {
    // Web Animations API: un latido corto de escala, independiente del count-up.
    this.host.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
      { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }

  private render(value: number): void {
    this.displayed = value;
    this.host.textContent = formatCount(value);
  }

  private cancel(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}
