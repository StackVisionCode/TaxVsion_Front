import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/** Tono del botón de confirmación: rojo para lo destructivo, marca para lo reversible. */
export type ReasonDialogTone = 'danger' | 'primary';

/**
 * Confirmación con MOTIVO (items 6.2/6.3): igual que `app-confirm-dialog` pero con un textarea cuyo
 * texto viaja al backend y queda en el rastro de auditoría de la factura. El motivo puede ser
 * obligatorio (`minLength > 0`, p. ej. reemitir) u opcional (anular, cambio de estado manual).
 *
 * Tonto: el padre es dueño de la apertura y recibe el motivo ya recortado (null si quedó vacío).
 */
@Component({
  selector: 'app-reason-dialog',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './reason-dialog.component.html',
})
export class ReasonDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() heading = 'Are you sure?';
  @Input() message = '';
  @Input() confirmLabel = 'Confirm';
  @Input() tone: ReasonDialogTone = 'danger';
  @Input() reasonLabel = 'Reason';
  @Input() placeholder = 'Add a short note for the audit trail';
  /** 0 = motivo opcional; >0 = obligatorio con ese mínimo de caracteres. */
  @Input() minLength = 0;
  @Input() maxLength = 500;

  @Output() confirmed = new EventEmitter<string | null>();
  @Output() cancelled = new EventEmitter<void>();

  readonly reason = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    // Cada apertura empieza en blanco: no arrastrar el motivo de otra factura.
    if (changes['isOpen'] && this.isOpen) {
      this.reason.set('');
    }
  }

  get required(): boolean {
    return this.minLength > 0;
  }

  get canConfirm(): boolean {
    return this.reason().trim().length >= this.minLength;
  }

  confirm(): void {
    if (!this.canConfirm) {
      return;
    }
    const text = this.reason().trim();
    this.confirmed.emit(text.length > 0 ? text : null);
  }
}
