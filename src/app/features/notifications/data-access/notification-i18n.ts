export type NotificationLocale = 'en' | 'es';

/**
 * Verbo del CTA primario del detalle de notificación. Lo determina el backend
 * (consumer rellena `action` al publicar la notificación) y el front lo pinta
 * tal cual en el modal — así agregar un `kind` nuevo no requiere tocar la UI,
 * basta con que el consumer mande el `action` correcto.
 */
export type NotificationAction = 'open' | 'review' | 'sign' | 'pay' | 'reconnect';

const ACTION_LABELS: Readonly<Record<NotificationAction, readonly [en: string, es: string]>> = {
  open: ['Open', 'Abrir'],
  review: ['Review', 'Revisar'],
  sign: ['Sign', 'Firmar'],
  pay: ['Pay', 'Pagar'],
  reconnect: ['Reconnect', 'Reconectar'],
};

/**
 * Label legible de los `resourceType` del catálogo del backend. Permite pintar
 * un chip "Signature request" en el detalle sin que el componente tenga que
 * conocer el enum. Un resourceType desconocido devuelve el valor tal cual
 * (que ya es legible: `file`, `mailbox`, ...).
 */
const RESOURCE_LABELS: Readonly<Record<string, readonly [en: string, es: string]>> = {
  file: ['File', 'Archivo'],
  document: ['Document', 'Documento'],
  signature_request: ['Signature request', 'Solicitud de firma'],
  email_thread: ['Email thread', 'Hilo de correo'],
  mailbox: ['Mailbox', 'Buzón'],
  task: ['Task', 'Tarea'],
  reminder: ['Reminder', 'Recordatorio'],
  client_request: ['Client request', 'Solicitud al cliente'],
  meeting: ['Meeting', 'Reunión'],
  recording: ['Recording', 'Grabación'],
  appointment: ['Appointment', 'Cita'],
  billing: ['Billing', 'Facturación'],
  invoice: ['Invoice', 'Factura'],
  conversation: ['Conversation', 'Conversación'],
  customer_documents: ['Client documents', 'Documentos del cliente'],
  storage_settings: ['Storage settings', 'Ajustes de almacenamiento'],
  mailbox_settings: ['Mailbox settings', 'Ajustes del buzón'],
  security_settings: ['Security settings', 'Ajustes de seguridad'],
  import_job: ['Import job', 'Importación'],
  support_ticket: ['Support ticket', 'Ticket de soporte'],
  seats: ['Seats', 'Asientos'],
};

export function isNotificationAction(value: string | null | undefined): value is NotificationAction {
  return value === 'open' || value === 'review' || value === 'sign' || value === 'pay' || value === 'reconnect';
}

export function notificationActionLabel(
  action: string | null | undefined,
  locale = resolveNotificationLocale(),
): string | null {
  if (!isNotificationAction(action)) return null;
  const [en, es] = ACTION_LABELS[action];
  return locale === 'es' ? es : en;
}

export function notificationResourceLabel(
  resourceType: string | null | undefined,
  locale = resolveNotificationLocale(),
): string | null {
  if (!resourceType) return null;
  const copy = RESOURCE_LABELS[resourceType];
  if (!copy) return resourceType;
  const [en, es] = copy;
  return locale === 'es' ? es : en;
}

/**
 * Iniciales (hasta 2 letras) a mostrar dentro del círculo-avatar cuando el actor
 * trae `actorDisplayName`. Toma la primera letra de hasta las dos primeras
 * palabras, en mayúsculas, latiniza acentos y descarta cualquier cosa que no
 * sea letra latina para no romper el ancho fijo del círculo. Devuelve null
 * cuando no hay texto utilizable — el caller sigue con el icono por tipo.
 *
 * "Juan Pérez"       → "JP"
 * "ADMIN"            → "A"
 * "  maría josé  "   → "MJ"
 * "李"               → null (no cae a basura, deja al caller usar icono)
 */
export function notificationActorInitials(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const normalized = displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  if (!normalized) return null;
  const words = normalized.split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .filter((char) => /[a-zA-Z]/.test(char))
    .join('')
    .toUpperCase();
  return initials.length > 0 ? initials : null;
}

export interface NotificationTextPayload {
  title: string;
  body: string;
  titleKey?: string | null;
  bodyKey?: string | null;
  params?: Readonly<Record<string, string>> | null;
  /** `kind` del evento (p.ej. `tasks.task_overdue`). Permite fallback por kind
   *  cuando el backend no envio titleKey/bodyKey pero el kind si esta en el catalogo. */
  kind?: string | null;
}

type LocalizedCopy = readonly [englishTitle: string, englishBody: string, spanishTitle: string, spanishBody: string];

const COPY_BY_KIND: Readonly<Record<string, LocalizedCopy>> = {
  'cloudstorage.file.blocked_by_policy': ['File blocked', 'A file was blocked by storage policy.', 'Archivo bloqueado', 'Un archivo fue bloqueado por la politica de almacenamiento.'],
  'cloudstorage.file.infected': ['Threat detected in a file', 'Review the affected file and take action.', 'Amenaza detectada en un archivo', 'Revisa el archivo afectado y toma una accion.'],
  'cloudstorage.storage_limit_exceeded': ['Storage limit reached', 'Free space or update the storage settings.', 'Limite de almacenamiento alcanzado', 'Libera espacio o actualiza la configuracion de almacenamiento.'],
  'cloudstorage.sharelink.folder_item_added': ['New item in a shared folder', 'A new item was added to a folder you shared.', 'Nuevo elemento en una carpeta compartida', 'Se agrego un elemento a una carpeta que compartiste.'],
  'cloudstorage.file.blocked_by_dmca_takedown': ['File restricted by a legal notice', 'Review the legal restriction applied to this file.', 'Archivo restringido por un aviso legal', 'Revisa la restriccion legal aplicada a este archivo.'],
  'cloudstorage.file.reinstated_from_takedown': ['File access restored', 'The legal restriction on this file was lifted.', 'Acceso al archivo restaurado', 'Se levanto la restriccion legal de este archivo.'],
  'cloudstorage.file.legal_hold_placed': ['File placed on legal hold', 'The file cannot be deleted while the hold is active.', 'Archivo bajo retencion legal', 'El archivo no puede eliminarse mientras la retencion este activa.'],
  'cloudstorage.file.legal_hold_lifted': ['Legal hold lifted', 'The file is no longer under legal hold.', 'Retencion legal levantada', 'El archivo ya no esta bajo retencion legal.'],
  'cloudstorage.dmca.counter_notice_submitted': ['Counter notice submitted', 'A counter notice was submitted for review.', 'Contranotificacion enviada', 'Se envio una contranotificacion para revision.'],
  'cloudstorage.customer_document_uploaded': ['Client uploaded documents', 'New client documents are ready for review.', 'Un cliente subio documentos', 'Hay nuevos documentos del cliente listos para revisar.'],
  'signature.signer.invited': ['Signature requested', 'A document is waiting for your signature.', 'Firma solicitada', 'Hay un documento esperando tu firma.'],
  'signature.document.signed': ['Document signed', 'A signer completed a document.', 'Documento firmado', 'Un firmante completo un documento.'],
  'signature.request.completed': ['Signature request completed', 'All required signatures were completed.', 'Solicitud de firma completada', 'Se completaron todas las firmas requeridas.'],
  'signature.signer.rejected': ['Signature declined', 'A signer declined the signature request.', 'Firma rechazada', 'Un firmante rechazo la solicitud de firma.'],
  'signature.request.expired': ['Signature request expired', 'The request expired before it was completed.', 'Solicitud de firma vencida', 'La solicitud vencio antes de completarse.'],
  'signature.signer.verification_failed': ['Signer verification failed', 'Review the failed signer verification attempt.', 'Fallo la verificacion del firmante', 'Revisa el intento fallido de verificacion del firmante.'],
  'signature.signer.pin_failed': ['Signer PIN failed', 'Review the failed PIN verification attempt.', 'Fallo el PIN del firmante', 'Revisa el intento fallido de verificacion del PIN.'],
  'signature.request.sealing_failed': ['Document sealing failed', 'The completed request could not be sealed.', 'Fallo el sellado del documento', 'No se pudo sellar la solicitud completada.'],
  'signature.request.canceled_by_another': ['Signature request canceled', 'Another participant canceled the request.', 'Solicitud de firma cancelada', 'Otro participante cancelo la solicitud.'],
  'customer.bulk_imported': ['Client import completed', 'The client import finished successfully.', 'Importacion de clientes completada', 'La importacion de clientes finalizo correctamente.'],
  'customer.import_failed': ['Client import failed', 'Review the import errors and try again.', 'Fallo la importacion de clientes', 'Revisa los errores de importacion e intenta nuevamente.'],
  'connectors.oauth.refresh_failed': ['Reconnect {providerCode}', 'Access to the {providerCode} mailbox could not be renewed.', 'Reconecta {providerCode}', 'No se pudo renovar el acceso al buzon de {providerCode}.'],
  'connectors.watch.expired': ['Mailbox connection expired', 'Reconnect {providerCode} to resume incoming mail.', 'La conexion del buzon vencio', 'Reconecta {providerCode} para reanudar el correo entrante.'],
  'correspondence.customer_email_received': ['New email from a client', 'Open the conversation to review the new message.', 'Nuevo correo de un cliente', 'Abre la conversacion para revisar el nuevo mensaje.'],
  'tasks.task_assigned': ['Task assigned to you', 'Open the task to review the details.', 'Tarea asignada', 'Abre la tarea para revisar los detalles.'],
  'tasks.task_overdue': ['Task overdue', 'A task assigned to you is overdue.', 'Tarea vencida', 'Una tarea asignada esta vencida.'],
  'tasks.attachment_rejected': ['Task attachment rejected', 'Review the rejected attachment and the requested changes.', 'Adjunto de tarea rechazado', 'Revisa el adjunto rechazado y los cambios solicitados.'],
  'tasks.client_request_created': ['New request from your office', 'Open the request to see what is needed.', 'Nueva solicitud de tu oficina', 'Abre la solicitud para ver lo que se necesita.'],
  'tasks.client_request_fulfilled': ['Client request fulfilled', 'The requested items are ready for review.', 'Solicitud del cliente completada', 'Los elementos solicitados estan listos para revision.'],
  'tasks.client_request_document_rejected': ['Document needs changes', 'Your office rejected a document in this request.', 'Un documento necesita cambios', 'Tu oficina rechazo un documento de esta solicitud.'],
  'tasks.waiting_on_client': ['Task waiting on you', 'Your office needs information to continue this task.', 'Tarea esperando tu respuesta', 'Tu oficina necesita informacion para continuar esta tarea.'],
  'reminders.due': ['Reminder due', 'A scheduled reminder is due.', 'Recordatorio pendiente', 'Un recordatorio programado esta pendiente.'],
  'calendar.appointment_scheduled': ['Appointment scheduled', 'A new appointment was added to your calendar.', 'Cita programada', 'Se agrego una nueva cita a tu calendario.'],
  'calendar.attendee_added': ['Added to an appointment', 'You were added as an appointment attendee.', 'Agregado a una cita', 'Fuiste agregado como participante de una cita.'],
  'calendar.appointment_rescheduled': ['Appointment rescheduled', 'The appointment time was changed.', 'Cita reprogramada', 'Se cambio la hora de la cita.'],
  'calendar.appointment_cancelled': ['Appointment canceled', 'An appointment was canceled.', 'Cita cancelada', 'Se cancelo una cita.'],
  'calendar.attendee_responded': ['Appointment response received', 'An attendee responded to the appointment.', 'Respuesta de cita recibida', 'Un participante respondio a la cita.'],
  'calendar.appointment_starting_soon': ['Appointment starting soon', 'Your appointment will begin soon.', 'La cita comenzara pronto', 'Tu cita comenzara pronto.'],
  'communication.meeting.invitation_created': ['Meeting invitation', 'You were invited to a meeting.', 'Invitacion a reunion', 'Fuiste invitado a una reunion.'],
  'communication.call.missed': ['Missed call', 'You missed a call.', 'Llamada perdida', 'Perdiste una llamada.'],
  'communication.call.recording_ready': ['Call recording ready', 'The call recording is ready to review.', 'Grabacion de llamada lista', 'La grabacion de la llamada esta lista para revisar.'],
  'communication.call.recording_failed': ['Call recording failed', 'The call recording could not be processed.', 'Fallo la grabacion de la llamada', 'No se pudo procesar la grabacion de la llamada.'],
  'communication.meeting.recording_ready': ['Meeting recording ready', 'The meeting recording is ready to review.', 'Grabacion de reunion lista', 'La grabacion de la reunion esta lista para revisar.'],
  'communication.meeting.recording_failed': ['Meeting recording failed', 'The meeting recording could not be processed.', 'Fallo la grabacion de la reunion', 'No se pudo procesar la grabacion de la reunion.'],
  'communication.support.opened': ['New support ticket', 'A tenant opened a support ticket.', 'Nuevo ticket de soporte', 'Un tenant abrio un ticket de soporte.'],
  'auth.security_alert': ['Security alert', 'Review recent security activity on your account.', 'Alerta de seguridad', 'Revisa la actividad de seguridad reciente de tu cuenta.'],
  'auth.user_slot_gated': ['User access paused', 'A user needs an available seat to regain access.', 'Acceso de usuario pausado', 'Un usuario necesita un asiento disponible para recuperar el acceso.'],
  'auth.user_slot_unlocked': ['User access restored', 'A seat became available and access was restored.', 'Acceso de usuario restaurado', 'Un asiento quedo disponible y se restauro el acceso.'],
  'subscription.status_changed': ['Subscription action required', 'Review the current subscription status.', 'Accion requerida en la suscripcion', 'Revisa el estado actual de la suscripcion.'],
  'subscription.renewal_upcoming': ['Subscription renewal upcoming', 'Your subscription renewal date is approaching.', 'Renovacion de suscripcion proxima', 'Se acerca la fecha de renovacion de tu suscripcion.'],
  'payment_app.payment_method_expiring_soon': ['Payment method expiring soon', 'Update the payment method before it expires.', 'Metodo de pago por vencer', 'Actualiza el metodo de pago antes de que venza.'],
  'payment_client.tenant_payment_succeeded': ['Payment received', 'A tenant payment was completed successfully.', 'Pago recibido', 'Un pago del tenant se completo correctamente.'],
  'payment_client.payout_failed': ['Payout failed', 'Review the payout failure and payment settings.', 'Fallo el desembolso', 'Revisa el fallo del desembolso y la configuracion de pagos.'],
  'payment_client.connect_account_restricted': ['Payment account restricted', 'Review the payment account restrictions.', 'Cuenta de pagos restringida', 'Revisa las restricciones de la cuenta de pagos.'],
  'payment_client.connect_account_onboarding_required': ['Payment account setup required', 'Complete the payment account setup.', 'Configuracion de pagos requerida', 'Completa la configuracion de la cuenta de pagos.'],
  'billing.invoice_sent_to_customer': ['New invoice', 'Your office sent you an invoice.', 'Nueva factura', 'Tu oficina te envio una factura.'],
  'documents.generation_failed': ['Document generation failed', 'Review the failed document and try again.', 'Fallo la generacion del documento', 'Revisa el documento fallido e intenta nuevamente.'],
};

export function resolveNotificationLocale(explicitLocale?: string | null): NotificationLocale {
  // El CRM es inglés por diseño (no hay selector de idioma todavía) — solo caemos a 'es'
  // cuando el usuario lo elige explícitamente, no por navigator.languages del perfil, para
  // no mezclar títulos/cuerpos en español con el resto del UI en inglés.
  if (explicitLocale) {
    return explicitLocale.toLowerCase().startsWith('es') ? 'es' : 'en';
  }
  return 'en';
}

export function notificationText(payload: NotificationTextPayload, locale = resolveNotificationLocale()): { title: string; body: string } {
  return {
    title: translate(payload.titleKey, payload.title, payload.params, locale, payload.kind, 'title'),
    body: translate(payload.bodyKey, payload.body, payload.params, locale, payload.kind, 'body'),
  };
}

export function notificationRelativeTime(value: string, now = Date.now(), locale = resolveNotificationLocale()): string {
  const timestamp = parseUtc(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, 'day');
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(timestamp);
}

export function notificationAbsoluteTime(value: string, timeZone: string, locale = resolveNotificationLocale()): string {
  const date = parseUtc(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}

function translate(
  key: string | null | undefined,
  fallback: string,
  params: Readonly<Record<string, string>> | null | undefined,
  locale: NotificationLocale,
  kind: string | null | undefined,
  slot: 'title' | 'body',
): string {
  // 1) titleKey/bodyKey del backend (`notif.<kind>.title|body`): resolucion directa.
  const match = key?.match(/^notif\.(.+)\.(title|body)$/);
  let copy = match ? COPY_BY_KIND[match[1]] : undefined;
  let effectiveSlot: 'title' | 'body' = match ? (match[2] as 'title' | 'body') : slot;
  // 2) Fallback por `kind` cuando falta titleKey/bodyKey (backend emitio sin claves).
  if (!copy && kind) {
    copy = COPY_BY_KIND[kind];
  }
  if (copy) {
    const template = locale === 'es'
      ? copy[effectiveSlot === 'title' ? 2 : 3]
      : copy[effectiveSlot === 'title' ? 0 : 1];
    return interpolate(template || fallback, params ?? {});
  }
  // 3) Fallback crudo del backend (ya expandido server-side): no re-interpolamos
  //    para no borrar literales `{foo}` que no coincidan con params como "".
  return fallback;
}

function interpolate(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => params[name] ?? '');
}

function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
}
