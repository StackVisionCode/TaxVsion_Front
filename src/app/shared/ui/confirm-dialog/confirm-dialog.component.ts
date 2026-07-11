import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../modal/modal.component';

/**
 * Diálogo de confirmación para acciones destructivas (equivalente al
 * `confirmation-modal` del CRM original, que nunca se había migrado):
 * compuesto sobre `app-modal` (size sm), con círculo rojo pastel + icono de
 * alerta, mensaje y botones Cancel / confirmación en rojo. El padre es dueño
 * del estado de apertura y ejecuta la acción real al recibir `confirmed`.
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
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}
