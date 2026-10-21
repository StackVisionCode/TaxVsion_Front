import { prefersReducedMotion } from './reduced-motion.util';

/**
 * Índice lateral que sigue el scroll (Profile, Office Settings): avisa qué sección cruza la franja
 * superior de la ventana. Devuelve la función que deja de observar (llamarla al destruir la vista).
 * Sin IntersectionObserver (tests con jsdom) no hace nada.
 */
export function observeActiveSection(
  root: HTMLElement,
  sectionIds: readonly string[],
  onActive: (id: string) => void,
): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    return () => {};
  }
  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          onActive(entry.target.id);
        }
      }
    },
    { rootMargin: '-20% 0px -70% 0px' },
  );
  for (const id of sectionIds) {
    const el = root.querySelector(`#${id}`);
    if (el) observer.observe(el);
  }
  return () => observer.disconnect();
}

/** Lleva la sección al inicio de la ventana (suave salvo que el usuario pida menos movimiento). */
export function scrollToSection(root: HTMLElement, sectionId: string): void {
  root
    .querySelector(`#${sectionId}`)
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
