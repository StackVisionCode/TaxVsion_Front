/** Tipo visual de un toast — decide color e icono en el host. */
export type ToastKind = 'success' | 'error' | 'info';

/** Botón opcional dentro del toast ("Leave and join", "Undo"…); al pulsarlo se cierra el toast. */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/** Un toast en la cola. `id` es estable para el trackBy y para descartarlo. */
export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly action?: ToastAction;
  /** Slot único (p.ej. el aviso de rate limit con cuenta regresiva); ausente en los toasts comunes. */
  readonly key?: string;
  /** true durante la animación de salida (antes del desmontaje diferido). */
  readonly leaving?: boolean;
}
