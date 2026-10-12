import { AccessRequirement } from '@core/access/features';
import { DashboardWidgetId } from './dashboard-layout.store';

/**
 * B5 — qué necesita cada widget del dashboard para tener sentido.
 *
 * Hasta acá los 13 widgets se montaban siempre y cada uno pedía lo suyo al backend: el empleado
 * abría el panel y veía media pantalla de tarjetas de error, una por cada 403. No es solo feo —
 * son peticiones que sabemos de antemano que van a fallar.
 *
 * `null` = el widget no depende de nada: lo que consulta es transversal (las notificaciones) o se
 * filtra solo por dentro (el hero).
 *
 * Los permissions son los que exige el endpoint que el widget realmente llama, verificados contra
 * los controladores — no los que uno supondría por el nombre del widget. El caso que más sorprende
 * es `storage-usage`: `GET /storage/usage` vive en `StorageAdministrationController` y pide
 * `cloudstorage.settings.manage`, no el `file.view` de la pantalla de documentos.
 */
const TASKS: AccessRequirement = { module: 'planner', anyOf: ['tasks.read'] };
const CALENDAR: AccessRequirement = { module: 'planner', anyOf: ['calendar.read'] };
const MEETINGS: AccessRequirement = {
  module: 'meetings',
  anyOf: ['communication.meeting.create', 'communication.meeting.join'],
};
const CHAT: AccessRequirement = { module: 'comms', anyOf: ['communication.chat.start', 'communication.chat.reply'] };
const SIGNATURES: AccessRequirement = { module: 'signatures', anyOf: ['signature.request.read'] };
const STORAGE_SETTINGS: AccessRequirement = { module: 'documents', anyOf: ['cloudstorage.settings.manage'] };
const WALLET: AccessRequirement = { module: null, anyOf: ['wallet.view'] };

/**
 * Un array significa "cualquiera de": los widgets que juntan varias fuentes (Today, Needs attention)
 * se muestran si al menos una sirve, y cada fuente se esconde sola dentro del widget.
 */
export type DashboardWidgetAccess = AccessRequirement | readonly AccessRequirement[] | null;

export const DASHBOARD_WIDGET_ACCESS: Readonly<Record<DashboardWidgetId, DashboardWidgetAccess>> = {
  // El saludo y los 3 contadores. No se esconde entero: es lo primero que se ve y además lleva el
  // nombre del usuario. Filtra sus propias tarjetas (ver `dashboard-hero.component.ts`).
  hero: null,
  // Agenda del día: tareas que vencen hoy, citas y reuniones.
  today: [TASKS, CALENDAR, MEETINGS],
  // Alertas accionables: vencidas, vencimientos fiscales, firmas por vencer, storage, wallet, chats.
  'needs-attention': [TASKS, SIGNATURES, WALLET, CHAT, STORAGE_SETTINGS],
  // El banner PRO: lo decide `canManageBilling` en el store del layout (B3).
  'side-stack': null,
  // "Completed this week" + "Filing deadlines": ambas salen de las tareas.
  'analytics-stack': TASKS,

  tasks: TASKS,
  'mini-calendar': CALENDAR,
  notes: { module: 'planner', anyOf: ['notes.read'] },

  'recent-chats': CHAT,
  // `meetings`, no `comms`: sus permisos son `communication.meeting.*`. Con `comms` un Starter veía el
  // widget (su plan sí trae chat y llamadas) y se comía un 403 al pedir las reuniones.
  'video-calls': MEETINGS,

  // Notificaciones del propio usuario: no hay plan ni permission que las gatee.
  'recent-activity': null,

  'invoices-chart': { module: null, anyOf: ['invoicing.view'] },
  'storage-usage': STORAGE_SETTINGS,
  'signed-documents': SIGNATURES,
  'monthly-clients': { module: 'customers', anyOf: ['customers.view'] },
};
