import { DestroyRef, ElementRef, Signal, afterNextRender, signal } from '@angular/core';

/** Padding inferior del app-shell (`p-4`): la página termina ahí, sin empujar el scroll. */
const SHELL_BOTTOM_PADDING = 16;

/**
 * Alto que deja a una página de dos paneles (Chat, Support) llenar el viewport sin crecer: solo scrollean sus
 * listas por dentro. Se recalcula al montar, con resize/rotación, el teclado del móvil (`visualViewport`) y
 * cuando algo encima cambia de alto (p. ej. el banner de la suscripción, observado vía `body`).
 * Debe llamarse en un contexto de inyección (constructor o inicializador de campo).
 */
export function fillViewportHeight(host: ElementRef<HTMLElement>, destroyRef: DestroyRef, minHeight: number): Signal<number | null> {
  const height = signal<number | null>(null);
  const measure = (): void => {
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const top = host.nativeElement.getBoundingClientRect().top + window.scrollY;
    height.set(Math.max(minHeight, Math.floor(viewport - top - SHELL_BOTTOM_PADDING)));
  };
  afterNextRender(() => {
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    observer?.observe(document.body);
    destroyRef.onDestroy(() => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      observer?.disconnect();
    });
  });
  return height.asReadonly();
}
