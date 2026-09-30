import { AccessRequirement } from '@core/access/features';
import { DashboardWidgetId } from './dashboard-layout.store';

/**
 * B5 — qué necesita cada widget del dashboard para tener sentido.
 *
 * Hasta acá los 13 widgets se montaban siempre y cada uno pedía lo suyo al backend: el empleado
 * abría el panel y veía media pantalla de tarjetas de error, una por cada 403. No es solo feo —
 * son peticiones que sabemos de antemano que van a fallar.
 *
 * `null` = el widget no depende de nada: o no habla con el backend (las gráficas de ejemplo) o lo
 * que consulta es transversal (las notificaciones).
 *
 * Los permissions son los que exige el endpoint que el widget realmente llama, verificados contra
 * los controladores — no los que uno supondría por el nombre del widget. El caso que más sorprende
 * es `storage-usage`: `GET /storage/usage` vive en `StorageAdministrationController` y pide
 * `cloudstorage.settings.manage`, no el `file.view` de la pantalla de documentos.
 */
export const DASHBOARD_WIDGET_ACCESS: Readonly<Record<DashboardWidgetId, AccessRequirement | null>> = {
  // El saludo y los 3 contadores. No se esconde entero: es lo primero que se ve y además lleva el
  // nombre del usuario. Filtra sus propias tarjetas (ver `dashboard-hero.component.ts`).
  hero: null,
  // El banner PRO se esconde solo, por `canManageBilling` (B3).
  'side-stack': null,
  // Gráficas de ejemplo: no piden nada al backend todavía.
  'analytics-stack': null,

  tasks: { module: 'planner', anyOf: ['tasks.read'] },
  'mini-calendar': { module: 'planner', anyOf: ['calendar.read'] },
  notes: { module: 'planner', anyOf: ['notes.read'] },

  'recent-chats': { module: 'comms', anyOf: ['communication.chat.start', 'communication.chat.reply'] },
  // `meetings`, no `comms`: sus permisos son `communication.meeting.*`. Con `comms` un Starter veía el
  // widget (su plan sí trae chat y llamadas) y se comía un 403 al pedir las reuniones.
  'video-calls': {
    module: 'meetings',
    anyOf: ['communication.meeting.create', 'communication.meeting.join'],
  },

  // Notificaciones del propio usuario: no hay plan ni permission que las gatee.
  'recent-activity': null,

  'invoices-chart': { module: null, anyOf: ['invoicing.view'] },
  'storage-usage': { module: 'documents', anyOf: ['cloudstorage.settings.manage'] },
  'signed-documents': { module: 'signatures', anyOf: ['signature.request.read'] },
  'monthly-clients': { module: 'customers', anyOf: ['customers.view'] },
};
