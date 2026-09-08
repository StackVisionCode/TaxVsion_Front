/**
 * ¿El usuario pidió menos movimiento a nivel de sistema?
 *
 * Se consulta en el momento (no se cachea) porque la preferencia se puede cambiar con la
 * app abierta. `matchMedia` puede no existir en entornos sin DOM (tests con jsdom parcial),
 * así que se degrada a "no reducir" en vez de reventar.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
