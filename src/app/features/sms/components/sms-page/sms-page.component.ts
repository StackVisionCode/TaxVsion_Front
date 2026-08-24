import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { SmsConversationListComponent } from '../../ui/sms-conversation-list/sms-conversation-list.component';
import { SmsThreadComponent } from '../../ui/sms-thread/sms-thread.component';
import { SmsComposerComponent } from '../../ui/sms-composer/sms-composer.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { SmsStore } from '../../data-access/sms.store';
import { SMS_BODY_MAX_LENGTH } from '../../data-access/sms.model';

/**
 * Página del módulo SMS (estilo "Aether"), cableada al servicio real (Sms.Api vía
 * POST /sms/messages). El backend NO expone lectura de historial ni de entrantes,
 * así que el rail lista los CLIENTES del despacho (GET /customers, réplica mínima)
 * y el hilo muestra solo lo enviado en esta sesión con los resultados reales del
 * lote. "New broadcast" sí es real: el endpoint es de lote nativo (1..N items), un
 * item por cliente con teléfono E.164 válido. Se quitó el botón "Call": no existe
 * integración de telefonía que lo respalde.
 */
@Component({
  selector: 'app-sms-page',
  imports: [CommonModule, FormsModule, SmsConversationListComponent, SmsThreadComponent, SmsComposerComponent, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-page.component.html',
  styleUrl: './sms-page.component.css',
})
export class SmsPageComponent implements OnInit {
  readonly store = inject(SmsStore);

  readonly isBroadcastOpen = signal(false);
  readonly broadcastText = signal('');
  readonly broadcastError = signal<string | null>(null);
  readonly toastMessage = signal<string | null>(null);
  readonly bodyMaxLength = SMS_BODY_MAX_LENGTH;

  /** El composer se bloquea si el cliente activo no tiene teléfono E.164 válido. */
  readonly canText = computed(() => !!this.store.activeContact()?.phoneE164);

  ngOnInit(): void {
    this.store.init();
  }

  selectContact(id: string): void {
    this.store.select(id);
  }

  sendMessage(text: string): void {
    this.store.sendToActive(text);
  }

  retryLoad(): void {
    this.store.loadContacts();
  }

  dismissActionError(): void {
    this.store.clearActionError();
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

  openBroadcast(): void {
    this.broadcastError.set(null);
    this.isBroadcastOpen.set(true);
  }

  closeBroadcast(): void {
    this.isBroadcastOpen.set(false);
    this.broadcastText.set('');
    this.broadcastError.set(null);
  }

  /**
   * Broadcast real: un POST /sms/messages con un item por cliente texteable. El
   * resumen del toast sale de los resultados por item (el backend no aborta el lote
   * por items fallidos: cada uno vuelve con su status/errorCode).
   */
  sendBroadcast(): void {
    const text = this.broadcastText().trim();
    if (!text || this.store.broadcastSending() || this.store.textableContacts().length === 0) {
      return;
    }
    this.broadcastError.set(null);
    this.store.sendBroadcast(text).subscribe({
      next: summary => {
        this.isBroadcastOpen.set(false);
        this.broadcastText.set('');
        const parts = [`${summary.sent} sent`];
        if (summary.failed > 0) {
          parts.push(`${summary.failed} failed`);
        }
        if (summary.suppressed > 0) {
          parts.push(`${summary.suppressed} opted out`);
        }
        this.showToast(`Broadcast: ${parts.join(', ')}`);
      },
      error: err => this.broadcastError.set(toApiError(err).message),
    });
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 3500);
  }
}
