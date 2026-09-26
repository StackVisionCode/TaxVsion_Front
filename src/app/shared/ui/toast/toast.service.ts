import { Injectable, signal } from '@angular/core';
import { Toast, ToastKind } from './toast.model';

interface CountdownSlot {
  readonly id: number;
  deadline: number;
  format: (secondsLeft: number) => string;
  readonly absorbs: readonly string[];
  readonly tick: ReturnType<typeof setInterval>;
}

/**
 * Cola de toasts de toda la app. Único punto para notificar acciones (crear,
 * editar, borrar, subir…). El `<app-toast-host>` (montado una sola vez en la
 * raíz) renderiza la señal `toasts`. Los mensajes SIEMPRE son texto ya limpio
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
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly countdowns = new Map<string, CountdownSlot>();

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
   * Toast único por `key` con cuenta regresiva: el texto se regenera cada segundo con `format` y se
   * cierra solo al llegar a 0. Si ya hay uno visible con esa clave, extiende la espera en vez de apilar
   * otro. Mientras está visible, los toasts cuyo texto esté en `absorbs` se descartan: dirían lo mismo
   * que él, solo que sin la cuenta.
   */
  countdown(
    key: string,
    kind: ToastKind,
    seconds: number,
    format: (secondsLeft: number) => string,
    absorbs: readonly string[] = [],
  ): void {
    const deadline = Date.now() + Math.max(1, Math.ceil(seconds)) * 1000;
    const active = this.countdowns.get(key);
    if (active) {
      active.deadline = Math.max(active.deadline, deadline);
      active.format = format;
      this.renderCountdown(key);
      return;
    }

    const id = this.nextId++;
    this.countdowns.set(key, {
      id,
      deadline,
      format,
      absorbs,
      tick: setInterval(() => this.renderCountdown(key), 1000),
    });
    // Lo que ya estaba en pantalla diciendo lo mismo se reemplaza por el aviso con la cuenta.
    this._toasts().filter(toast => absorbs.includes(toast.message)).forEach(toast => this.dismiss(toast.id));
    this._toasts.update(list => [...list, { id, kind, message: format(Math.ceil(seconds)), key }]);
  }

  /**
   * Descarta un toast por id (botón de cerrar o auto-dismiss). Lo marca `leaving` para que el
   * host reproduzca la salida y difiere el retiro real `EXIT_MS`; con `prefers-reduced-motion`
   * o si ya estaba saliendo, lo retira al instante.
   */
  dismiss(id: number): void {
    this.clearTimer(id);
    this.stopCountdownOf(id);
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

  // Una ráfaga de fallos iguales (p.ej. varios widgets del dashboard a la vez) apilaba un toast por
  // fallo: si ya hay uno visible con el mismo texto, solo se le reinicia la vida.
  private push(kind: ToastKind, message: string): void {
    if (this.isAbsorbed(message)) {
      return;
    }
    const duplicate = this._toasts().find(
      toast => !toast.leaving && !toast.key && toast.kind === kind && toast.message === message,
    );
    if (duplicate) {
      this.scheduleDismiss(duplicate.id);
      return;
    }
    const id = this.nextId++;
    this._toasts.update(list => [...list, { id, kind, message }]);
    this.scheduleDismiss(id);
  }

  private scheduleDismiss(id: number): void {
    this.clearTimer(id);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ToastService.AUTO_DISMISS_MS),
    );
  }

  private clearTimer(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  private renderCountdown(key: string): void {
    const slot = this.countdowns.get(key);
    if (!slot) {
      return;
    }
    const secondsLeft = Math.ceil((slot.deadline - Date.now()) / 1000);
    if (secondsLeft <= 0) {
      this.dismiss(slot.id);
      return;
    }
    const message = slot.format(secondsLeft);
    this._toasts.update(list => list.map(toast => (toast.id === slot.id ? { ...toast, message } : toast)));
  }

  private stopCountdownOf(id: number): void {
    for (const [key, slot] of this.countdowns) {
      if (slot.id === id) {
        clearInterval(slot.tick);
        this.countdowns.delete(key);
      }
    }
  }

  private isAbsorbed(message: string): boolean {
    for (const slot of this.countdowns.values()) {
      if (slot.absorbs.includes(message)) {
        return true;
      }
    }
    return false;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
