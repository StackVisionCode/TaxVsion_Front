import { AfterViewChecked, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SmsThreadMessage, SmsUiStatus } from '../../data-access/sms.model';

/**
 * Hilo de mensajes del módulo SMS (estilo "Aether"). Con el backend real solo
 * existen burbujas salientes (no hay endpoint de lectura de entrantes); el chip de
 * estado refleja el resultado del envío tal como lo devolvió POST /sms/messages:
 * Accepted→Sent, Pending, Delivered, Failed/Undeliverable→Failed y Suppressed→
 * "Opted out" (el destinatario respondió STOP y el backend no envía). El chip no se
 * auto-actualiza después: los DLR llegan por webhook server-side y no hay endpoint
 * para consultarlos. Auto-scroll al fondo cuando llegan mensajes nuevos.
 */
@Component({
  selector: 'app-sms-thread',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-thread.component.html',
})
export class SmsThreadComponent implements AfterViewChecked {
  @Input() messages: SmsThreadMessage[] = [];
  @Input() contactName = '';
  @Input() avatarColor = 'bg-brand-bold';

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

  statusIcon(status: SmsUiStatus): string {
    switch (status) {
      case 'delivered':
        return 'checkmark-done-outline';
      case 'pending':
        return 'time-outline';
      case 'failed':
        return 'alert-circle-outline';
      case 'suppressed':
        return 'hand-left-outline';
      default:
        return 'checkmark-outline';
    }
  }

  statusLabel(status: SmsUiStatus): string {
    switch (status) {
      case 'delivered':
        return 'Delivered';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      case 'suppressed':
        return 'Opted out';
      default:
        return 'Sent';
    }
  }

  statusColor(status: SmsUiStatus): string {
    switch (status) {
      case 'delivered':
        return 'text-emerald-500';
      case 'pending':
        return 'text-amber-500';
      case 'failed':
        return 'text-red-500';
      case 'suppressed':
        return 'text-amber-600';
      default:
        return 'text-gray-400';
    }
  }

  /** Tooltip de la burbuja: expone el código canónico del backend cuando falló. */
  statusTitle(message: SmsThreadMessage): string {
    return message.errorCode ? `Error code: ${message.errorCode}` : '';
  }
}
