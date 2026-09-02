import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { Toast } from './toast.model';

/**
 * Host global de toasts — se monta UNA sola vez en el shell. Lee la cola del
 * `ToastService` y la apila abajo-centro con la animación de entrada de la casa.
 * El color y el icono salen del `kind`. Marca dinámica: usa `bg-brand-bold`
 * (primary del tenant) y `gray-*` tematizables, sin hex fijos.
 */
@Component({
  selector: 'app-toast-host',
  templateUrl: './toast-host.component.html',
  styleUrl: './toast-host.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ToastHostComponent {
  private readonly toastService = inject(ToastService);

  readonly toasts = this.toastService.toasts;

  iconFor(kind: Toast['kind']): string {
    switch (kind) {
      case 'success':
        return 'checkmark-circle-outline';
      case 'error':
        return 'alert-circle-outline';
      default:
        return 'information-circle-outline';
    }
  }

  /** Clase de fondo por tipo — todas tematizables por el tenant. */
  pillClass(kind: Toast['kind']): string {
    switch (kind) {
      case 'error':
        return 'bg-red-500';
      case 'success':
        return 'bg-brand-bold';
      default:
        return 'bg-gray-900';
    }
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }

  trackById(_index: number, toast: Toast): number {
    return toast.id;
  }
}
