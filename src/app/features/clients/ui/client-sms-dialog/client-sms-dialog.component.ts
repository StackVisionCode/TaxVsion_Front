import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { CLIENT_SMS_MAX_LENGTH, ClientSmsPhoneOption } from '../../data-access/client-sms.model';

/** Lo que emite el modal al enviar; el contenedor hace el POST. */
export interface ClientSmsDraft {
  to: string;
  message: string;
}

/**
 * Modal "Send SMS" del perfil: elige uno de los teléfonos válidos del cliente (`phones`, ya
 * normalizados por `clientSmsPhoneOptions`) y escribe el texto. Presentacional: emite `send` y el
 * contenedor (`client-profile-page`) llama a la API y le pasa `sending`/`error`.
 *
 * Uso:
 * ```html
 * <app-client-sms-dialog [isOpen]="open()" [clientName]="c.displayName" [phones]="phones()"
 *   [sending]="sending()" [error]="error()" (send)="onSend($event)" (closed)="close()" />
 * ```
 */
@Component({
  selector: 'app-client-sms-dialog',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-sms-dialog.component.html',
})
export class ClientSmsDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() clientName = '';
  @Input() phones: ClientSmsPhoneOption[] = [];
  @Input() sending = false;
  @Input() error: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() send = new EventEmitter<ClientSmsDraft>();

  readonly maxLength = CLIENT_SMS_MAX_LENGTH;
  readonly to = signal('');
  readonly message = signal('');
  readonly length = computed(() => this.message().length);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.message.set('');
    }
    if ((changes['isOpen'] || changes['phones']) && this.isOpen) {
      // Conserva la elección si sigue siendo válida; si no, el primero (el principal).
      if (!this.phones.some(p => p.value === this.to())) {
        this.to.set(this.phones[0]?.value ?? '');
      }
    }
  }

  canSend(): boolean {
    const text = this.message().trim();
    return !this.sending && !!this.to() && text.length > 0 && this.message().length <= this.maxLength;
  }

  submit(): void {
    if (!this.canSend()) {
      return;
    }
    this.send.emit({ to: this.to(), message: this.message().trim() });
  }

  close(): void {
    this.closed.emit();
  }
}
