import { Injectable, signal } from '@angular/core';
import { Toast, ToastKind } from './toast.model';

/**
 * Cola de toasts de toda la app. Único punto para notificar acciones (crear,
 * editar, borrar, subir…). El `<app-toast-host>` (montado una sola vez en el
 * shell) renderiza la señal `toasts`. Los mensajes SIEMPRE son texto ya limpio
 * y en inglés — nunca se le pasa el error crudo del backend (usar
 * `toUserMessage` para derivar el texto antes de llamar aquí).
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private static readonly AUTO_DISMISS_MS = 3200;
  /** Debe casar con el keyframe de salida del host (`toast-fall`). */
  private static readonly EXIT_MS = 180;

  private nextId = 0;
  private readonly _toasts = signal<Toast[]>([]);

  /** Cola actual (solo lectura) para el host. */
  readonly toasts = this._toasts.asReadonly();

  success(message: string): void {
    this.push('success', message);
  }

  error(message: string): void {
    this.push('error', message);
  }

  info(message: string): void {
    this.push('info', message);
  }

  /**
   * Descarta un toast por id (botón de cerrar o auto-dismiss). Lo marca `leaving` para que el
   * host reproduzca la salida y difiere el retiro real `EXIT_MS`; con `prefers-reduced-motion`
   * o si ya estaba saliendo, lo retira al instante.
   */
  dismiss(id: number): void {
    const toast = this._toasts().find(item => item.id === id);
    if (!toast || toast.leaving || prefersReducedMotion()) {
      this.remove(id);
      return;
    }
    this._toasts.update(list => list.map(item => (item.id === id ? { ...item, leaving: true } : item)));
    setTimeout(() => this.remove(id), ToastService.EXIT_MS);
  }

  private remove(id: number): void {
    this._toasts.update(list => list.filter(toast => toast.id !== id));
  }

  private push(kind: ToastKind, message: string): void {
    const id = this.nextId++;
    this._toasts.update(list => [...list, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), ToastService.AUTO_DISMISS_MS);
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
