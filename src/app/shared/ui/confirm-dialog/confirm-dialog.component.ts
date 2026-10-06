import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../modal/modal.component';

/**
 * Diálogo de confirmación para acciones destructivas (equivalente al
 * `confirmation-modal` del CRM original, que nunca se había migrado):
 * compuesto sobre `app-modal` (size sm), con círculo rojo pastel + icono de
 * alerta, mensaje y botones Cancel / confirmación en rojo. El padre es dueño
 * del estado de apertura y ejecuta la acción real al recibir `confirmed`.
 *
 * Extensiones (defaults = salida de siempre):
 * - `tone`: 'danger' (default, rojo) | 'primary' (círculo `bg-indigo-50` + `help-outline` y botón
 *   brand `bg-brand-bold hover:bg-brand-ink`) para confirmaciones no destructivas.
 * - `icon`: sobreescribe el icono del círculo.
 * - `busy`: deshabilita ambos botones, muestra spinner en el de confirmar (y `busyLabel` si se da) e
 *   ignora el cierre por backdrop/Escape mientras dura la acción.
 * - `cancelLabel` (default 'Cancel').
 * - `<ng-content>`: contenido extra bajo el mensaje (no ocupa sitio si no se proyecta nada).
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [CommonModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  @Input() isOpen = false;
  @Input() heading = 'Are you sure?';
  @Input() message = '';
  @Input() confirmLabel = 'Delete';
  @Input() cancelLabel = 'Cancel';
  @Input() tone: 'danger' | 'primary' = 'danger';
  @Input() icon = '';
  @Input() busy = false;
  /** Texto del botón de confirmar mientras `busy` (vacío = conserva `confirmLabel`). */
  @Input() busyLabel = '';
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  onConfirm(): void {
    if (!this.busy) {
      this.confirmed.emit();
    }
  }

  onCancel(): void {
    // Mientras la acción está en curso no se cierra (ni con backdrop ni con Escape).
    if (!this.busy) {
      this.cancelled.emit();
    }
  }
}
