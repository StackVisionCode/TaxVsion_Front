import type { WritableSignal } from '@angular/core';
import { prefersReducedMotion } from './reduced-motion.util';

/** Fase de la coreografía de lanzamiento (`app-launch-overlay`). */
export type LaunchPhase = 'idle' | 'working' | 'done';

export interface LaunchTiming {
  /** Mínimo en "working" para que la animación no parpadee si el backend responde rápido. */
  minWorkingMs: number;
  /** Duración del cierre (sello + salida); debe cubrir las animaciones de `.is-done`. */
  doneMs: number;
}

export interface LaunchOptions<T> extends Partial<LaunchTiming> {
  /** Corre al aparecer el sello, con la pantalla todavía cubierta (cerrar diálogos por debajo). */
  onDone?: (result: T) => void;
  /**
   * No vuelve a idle al terminar: el llamador navega con la pantalla cubierta (`exit="hold"`) y la
   * vista nueva reemplaza al overlay. Si la navegación falla, el llamador lo pone en idle.
   */
  keepOnDone?: boolean;
}

const DEFAULT_TIMING: LaunchTiming = { minWorkingMs: 1100, doneMs: 1150 };

/**
 * Corre `action` con la coreografía: working (mínimo garantizado) → done (sello) → idle.
 * Un resultado falsy o una excepción cortan al instante y sin sello, para que el error del diálogo
 * se vea enseguida (no se hace esperar el mínimo a un fallo). Devuelve lo que devolvió la acción.
 */
export async function runWithLaunch<T>(
  phase: WritableSignal<LaunchPhase>,
  action: () => Promise<T>,
  options: LaunchOptions<T> = {},
): Promise<T> {
  const { minWorkingMs, doneMs } = { ...DEFAULT_TIMING, ...options };
  const reduced = prefersReducedMotion();
  const startedAt = Date.now();
  phase.set('working');

  let result: T;
  try {
    result = await action();
  } catch (error) {
    phase.set('idle');
    throw error;
  }
  if (!result) {
    phase.set('idle');
    return result;
  }

  const remaining = (reduced ? 0 : minWorkingMs) - (Date.now() - startedAt);
  if (remaining > 0) await wait(remaining);
  phase.set('done');
  options.onDone?.(result);
  await wait(reduced ? 500 : doneMs);
  if (!options.keepOnDone) phase.set('idle');
  return result;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
