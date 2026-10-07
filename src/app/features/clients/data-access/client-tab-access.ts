import { AccessRequirement } from '@core/access/features';

/** Pestañas del perfil de cliente (menú lateral). */
export type ClientProfileTabId =
  | 'overview'
  | 'info'
  | 'family'
  | 'documents'
  | 'signatures'
  | 'invoices'
  | 'work'
  | 'notes'
  | 'communication'
  | 'sms'
  | 'meetings'
  | 'calls'
  | 'bank'
  | 'reminders'
  | 'mileage'
  | 'portal';

/**
 * B5 — qué hace falta para que una pestaña tenga contenido. Lo que no está acá no depende de
 * nada: Overview, Details y Family son el propio cliente, y quien llegó a esta pantalla ya pasó
 * por `customers.view`; Bank y Mileage son estados vacíos declarados, sin backend todavía. Lo que se gatea es lo que llama a OTRO servicio y hoy contesta 403 en silencio.
 */
export const TAB_ACCESS: Partial<Record<ClientProfileTabId, AccessRequirement>> = {
  documents: { module: 'documents', anyOf: ['cloudstorage.file.view'] },
  signatures: { module: 'signatures', anyOf: ['signature.request.read'] },
  work: { module: 'planner', anyOf: ['tasks.read'] },
  notes: { module: 'planner', anyOf: ['notes.read'] },
  reminders: { module: 'planner', anyOf: ['reminders.read'] },
  communication: { module: 'email', anyOf: ['correspondence.read'] },
  sms: { module: null, anyOf: ['sms.read'] },
  meetings: { module: 'meetings', anyOf: ['communication.meeting.create', 'communication.meeting.join'] },
  invoices: { module: null, anyOf: ['invoicing.view'] },
  calls: { module: 'comms', anyOf: ['communication.call.start', 'communication.videocall.start'] },
};
