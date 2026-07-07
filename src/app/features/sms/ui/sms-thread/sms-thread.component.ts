import { AfterViewChecked, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SmsMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  text: string;
  time: string;
  status: 'sent' | 'delivered' | 'failed' | 'pending';
}

/**
 * Hilo de mensajes del módulo SMS (estilo "Aether"): burbujas negras
 * alineadas a la derecha para los mensajes salientes (enviados desde el
 * despacho) y burbujas blancas con borde y avatar para los entrantes del
 * contacto. Cada burbuja saliente muestra debajo un chip de estado de
 * entrega (Sent/Delivered/Pending/Failed) siguiendo las convenciones de
 * apps de SMS. Auto-scroll al fondo cuando llegan mensajes nuevos.
 */
@Component({
  selector: 'app-sms-thread',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-thread.component.html',
})
export class SmsThreadComponent implements AfterViewChecked {
  @Input() messages: SmsMessage[] = [];
  @Input() contactName = '';
  @Input() avatarColor = 'bg-gray-900';

  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;

  ngAfterViewChecked(): void {
    this.scrollAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }

  statusIcon(status: SmsMessage['status']): string {
    switch (status) {
      case 'delivered':
        return 'checkmark-done-outline';
      case 'pending':
        return 'time-outline';
      case 'failed':
        return 'alert-circle-outline';
      default:
        return 'checkmark-outline';
    }
  }

  statusLabel(status: SmsMessage['status']): string {
    switch (status) {
      case 'delivered':
        return 'Delivered';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      default:
        return 'Sent';
    }
  }

  statusColor(status: SmsMessage['status']): string {
    switch (status) {
      case 'delivered':
        return 'text-emerald-500';
      case 'pending':
        return 'text-amber-500';
      case 'failed':
        return 'text-red-500';
      default:
        return 'text-gray-400';
    }
  }
}
