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

  /** Descarta un toast por id (botón de cerrar o auto-dismiss). */
  dismiss(id: number): void {
    this._toasts.update(list => list.filter(toast => toast.id !== id));
  }

  private push(kind: ToastKind, message: string): void {
    const id = this.nextId++;
    this._toasts.update(list => [...list, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), ToastService.AUTO_DISMISS_MS);
  }
}
