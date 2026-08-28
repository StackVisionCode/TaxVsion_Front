import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/**
 * Confirmación con contraseña para las acciones sensibles de MFA (desactivar y
 * regenerar códigos): el backend exige `password` en ambos endpoints, así que no
 * sirve `app-confirm-dialog` tal cual — este modal se compone sobre el mismo
 * `app-modal` compartido y replica su lenguaje (círculo de alerta + botón rojo
 * cuando es destructivo). Presentacional: el padre hace la llamada.
 */
@Component({
  selector: 'app-mfa-password-modal',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mfa-password-modal.component.html',
  styleUrl: './mfa-password-modal.component.css',
})
export class MfaPasswordModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() heading = '';
  @Input() message = '';
  @Input() confirmLabel = 'Confirm';
  @Input() busyLabel = 'Working…';
  /** true pinta la acción en rojo (desactivar MFA); false usa la marca. */
  @Input() destructive = false;
  @Input() busy = false;
  @Input() error: string | null = null;

  @Output() confirmed = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  readonly password = signal('');
  readonly localError = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.password.set('');
      this.localError.set(null);
    }
  }

  submit(): void {
    const password = this.password();
    if (!password) {
      this.localError.set('Enter your current password to continue.');
      return;
    }
    this.localError.set(null);
    this.confirmed.emit(password);
  }
}
