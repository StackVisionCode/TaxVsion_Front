/** Tipo visual de un toast — decide color e icono en el host. */
export type ToastKind = 'success' | 'error' | 'info';

/** Un toast en la cola. `id` es estable para el trackBy y para descartarlo. */
export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  /** true durante la animación de salida (antes del desmontaje diferido). */
  readonly leaving?: boolean;
}
