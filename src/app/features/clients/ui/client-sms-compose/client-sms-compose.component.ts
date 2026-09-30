import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { CLIENT_SMS_MAX_LENGTH, SmsPhoneOption } from '../../data-access/client-sms.model';

/** Lo que emite el modal al enviar: número E.164 elegido + texto. */
export interface ClientSmsDraft {
  to: string;
  body: string;
}

/**
 * Modal "Send SMS" del perfil: elige uno de los números del cliente y escribe el texto.
 * Presentacional — el envío real (`POST /sms/messages`) lo hace el contenedor. Si el cliente no
 * tiene ningún número válido, lo dice y ofrece ir a editar el contacto (emite `editContact`).
 */
@Component({
  selector: 'app-client-sms-compose',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-sms-compose.component.html',
})
export class ClientSmsComposeComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() clientName = '';
  @Input() phoneOptions: SmsPhoneOption[] = [];
  @Input() sending = false;
  /** Error amable del último intento (lo arma el store). */
  @Input() error: string | null = null;
  @Input() canEditContact = false;

  @Output() send = new EventEmitter<ClientSmsDraft>();
  @Output() closed = new EventEmitter<void>();
  @Output() editContact = new EventEmitter<void>();

  readonly maxLength = CLIENT_SMS_MAX_LENGTH;
  readonly to = signal('');
  readonly body = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.body.set('');
      this.to.set(this.phoneOptions[0]?.value ?? '');
    } else if (changes['phoneOptions'] && !this.phoneOptions.some(o => o.value === this.to())) {
      this.to.set(this.phoneOptions[0]?.value ?? '');
    }
  }

  /** Segmentos SMS aproximados (160 GSM-7 por segmento; 153 si hay más de uno). Solo orientativo. */
  segments(): number {
    const length = this.body().length;
    return length <= 160 ? 1 : Math.ceil(length / 153);
  }

  canSend(): boolean {
    return !this.sending && !!this.to() && this.body().trim().length > 0 && this.body().length <= this.maxLength;
  }

  submit(): void {
    if (this.canSend()) {
      this.send.emit({ to: this.to(), body: this.body() });
    }
  }

  close(): void {
    this.closed.emit();
  }
}
