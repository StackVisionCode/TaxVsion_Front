import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SmsService } from './sms.service';
import {
  SendSmsBatchResponse,
  SmsContact,
  SmsContactListItem,
  SmsSendItemResult,
  SmsThreadMessage,
  apiStatusToUi,
  timeLabel,
  toSmsContact,
} from './sms.model';

/** Resumen de un broadcast para el toast de la página. */
export interface SmsBroadcastSummary {
  requested: number;
  sent: number;
  suppressed: number;
  failed: number;
}

/** Marca de origen que viaja en sourceContext (auditoría en los eventos del backend). */
const SOURCE_CONTEXT = 'crm-sms';

/**
 * Store del módulo SMS (Sms.Api vía /sms). providedIn: 'root' — una sola instancia
 * para la ruta del módulo.
 *
 * Diseño impuesto por el contrato: el backend NO tiene endpoints de lectura (ni
 * historial, ni hilos, ni mensajes entrantes), así que:
 *  - el rail no lista "conversaciones" sino CLIENTES (GET /customers, réplica mínima);
 *  - el hilo muestra únicamente lo enviado EN ESTA SESIÓN, construido con los
 *    resultados reales de POST /sms/messages — nunca datos inventados;
 *  - el estado del chip queda como lo devolvió el envío (no hay endpoint para
 *    refrescar el DLR que llega después por webhook).
 */
@Injectable({ providedIn: 'root' })
export class SmsStore {
  private readonly service = inject(SmsService);

  // ---------- Estado crudo ----------
  private readonly _contacts = signal<SmsContact[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Error transitorio de un envío: banner descartable, no rompe la bandeja. */
  private readonly _actionError = signal<string | null>(null);
  private readonly _activeContactId = signal<string | null>(null);
  private readonly _sending = signal(false);
  private readonly _broadcastSending = signal(false);
  /** Mensajes de la sesión por cliente (solo salientes: no hay feed de entrantes). */
  private readonly _sessionMessages = signal<ReadonlyMap<string, SmsThreadMessage[]>>(new Map());
  private initialized = false;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly sending = this._sending.asReadonly();
  readonly broadcastSending = this._broadcastSending.asReadonly();
  readonly activeContactId = this._activeContactId.asReadonly();

  readonly contacts = this._contacts.asReadonly();

  /** Clientes a los que sí se puede textear (teléfono E.164 válido en la ficha). */
  readonly textableContacts = computed<SmsContact[]>(() =>
    this._contacts().filter(contact => contact.phoneE164 !== null),
  );

  readonly activeContact = computed<SmsContact | null>(() => {
    const id = this._activeContactId();
    return this._contacts().find(contact => contact.id === id) ?? null;
  });

  /** Hilo del contacto activo (solo la sesión actual). */
  readonly activeMessages = computed<SmsThreadMessage[]>(() => {
    const id = this._activeContactId();
    return id ? (this._sessionMessages().get(id) ?? []) : [];
  });

  /** Filas del rail: contacto + preview del último mensaje de la sesión. */
  readonly contactItems = computed<SmsContactListItem[]>(() => {
    const sessions = this._sessionMessages();
    return this._contacts().map(contact => {
      const messages = sessions.get(contact.id) ?? [];
      const last = messages[messages.length - 1];
      return {
        ...contact,
        preview: last?.text ?? (contact.phoneE164 ? 'No messages this session' : 'No phone on file'),
        lastTime: last?.time ?? '',
      };
    });
  });

  // ---------- Carga ----------

  /** Carga inicial idempotente del rail de clientes. */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.loadContacts();
  }

  loadContacts(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.listCustomers().subscribe({
      next: result => {
        const contacts = result.items
          .map(toSmsContact)
          .sort((a, b) => a.name.localeCompare(b.name));
        this._contacts.set(contacts);
        // Selección inicial: el primer cliente texteable (o el primero a secas).
        if (!this._activeContactId() && contacts.length > 0) {
          const first = contacts.find(contact => contact.phoneE164 !== null) ?? contacts[0];
          this._activeContactId.set(first.id);
        }
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  select(contactId: string): void {
    this._activeContactId.set(contactId);
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  // ---------- Envío individual ----------

  /**
   * Envía un texto al contacto activo. Optimista: la burbuja entra como "pending" y
   * al volver el lote se reemplaza con el resultado REAL del item (Accepted/Failed/
   * Suppressed…). Si el POST entero falla (red, 403 sin sms.send, 429 de cuota), la
   * burbuja pasa a failed y el error normalizado va al banner descartable.
   */
  sendToActive(text: string): void {
    const contact = this.activeContact();
    const body = text.trim();
    if (!contact || !contact.phoneE164 || !body || this._sending()) {
      return;
    }

    const localId = `local-${crypto.randomUUID()}`;
    this.appendMessage(contact.id, {
      id: localId,
      direction: 'outbound',
      text: body,
      time: timeLabel(),
      status: 'pending',
      errorCode: null,
    });

    this._sending.set(true);
    this.service
      .sendMessages({
        messages: [
          {
            customerId: contact.id,
            to: contact.phoneE164,
            message: body,
            media: null,
            // UUID por click: sin él, el backend deduplica por (customer, to, body) y
            // un reenvío intencional del mismo texto no saldría.
            idempotencyKey: crypto.randomUUID(),
            sourceContext: SOURCE_CONTEXT,
          },
        ],
      })
      .subscribe({
        next: response => {
          const result = response.results[0];
          this.patchMessage(contact.id, localId, message => ({
            ...message,
            id: result?.messageId ?? localId,
            status: result ? apiStatusToUi(result.status) : 'failed',
            errorCode: result?.errorCode ?? null,
          }));
          if (result?.status === 'Suppressed') {
            this._actionError.set(
              `${contact.name} opted out of SMS (replied STOP) — the message was not sent.`,
            );
          } else if (result?.errorCode) {
            this._actionError.set(`The message could not be sent (${result.errorCode}).`);
          }
          this._sending.set(false);
        },
        error: err => {
          this.patchMessage(contact.id, localId, message => ({
            ...message,
            status: 'failed',
            errorCode: toApiError(err).code,
          }));
          this._actionError.set(toApiError(err).message);
          this._sending.set(false);
        },
      });
  }

  // ---------- Broadcast ----------

  /**
   * Un solo POST /sms/messages con un item por cliente texteable (el endpoint es de
   * lote nativo, tope 1000 > nuestros 200 de página). Cada hilo de la sesión recibe
   * su burbuja con el resultado real del item correspondiente (match por customerId).
   */
  sendBroadcast(text: string): Observable<SmsBroadcastSummary> {
    const body = text.trim();
    const recipients = this.textableContacts();
    this._broadcastSending.set(true);

    return this.service
      .sendMessages({
        messages: recipients.map(contact => ({
          customerId: contact.id,
          to: contact.phoneE164 as string,
          message: body,
          media: null,
          idempotencyKey: crypto.randomUUID(),
          sourceContext: SOURCE_CONTEXT,
        })),
      })
      .pipe(
        tap({
          next: response => {
            this.appendBroadcastResults(body, response);
            this._broadcastSending.set(false);
          },
          error: () => this._broadcastSending.set(false),
        }),
        map(response => this.summarize(recipients.length, response)),
      );
  }

  private appendBroadcastResults(body: string, response: SendSmsBatchResponse): void {
    const byCustomer = new Map<string, SmsSendItemResult>(
      response.results.map(result => [result.customerId, result]),
    );
    const time = timeLabel();
    this._sessionMessages.update(current => {
      const next = new Map(current);
      for (const [customerId, result] of byCustomer) {
        const thread = next.get(customerId) ?? [];
        next.set(customerId, [
          ...thread,
          {
            id: result.messageId ?? `local-${crypto.randomUUID()}`,
            direction: 'outbound',
            text: body,
            time,
            status: apiStatusToUi(result.status),
            errorCode: result.errorCode,
          },
        ]);
      }
      return next;
    });
  }

  private summarize(requested: number, response: SendSmsBatchResponse): SmsBroadcastSummary {
    let sent = 0;
    let suppressed = 0;
    let failed = 0;
    for (const result of response.results) {
      switch (result.status) {
        case 'Suppressed':
          suppressed++;
          break;
        case 'Failed':
        case 'Undeliverable':
          failed++;
          break;
        default:
          sent++;
      }
    }
    return { requested, sent, suppressed, failed };
  }

  // ---------- Helpers ----------

  private appendMessage(contactId: string, message: SmsThreadMessage): void {
    this._sessionMessages.update(current => {
      const next = new Map(current);
      next.set(contactId, [...(next.get(contactId) ?? []), message]);
      return next;
    });
  }

  private patchMessage(
    contactId: string,
    messageId: string,
    patch: (message: SmsThreadMessage) => SmsThreadMessage,
  ): void {
    this._sessionMessages.update(current => {
      const next = new Map(current);
      const thread = next.get(contactId) ?? [];
      next.set(contactId, thread.map(message => (message.id === messageId ? patch(message) : message)));
      return next;
    });
  }
}
