import { SupportStatus } from '../data-access/support.model';

/** Etiqueta y color por estado del ticket (fila de la bandeja y cabecera del chat). */
export const SUPPORT_STATUS_META: Record<SupportStatus, { label: string; textClass: string; pillClass: string }> = {
  Open: { label: 'Open', textClass: 'text-blue-600', pillClass: 'border-blue-200 text-blue-600' },
  Claimed: { label: 'In progress', textClass: 'text-indigo-600', pillClass: 'border-indigo-200 text-indigo-600' },
  WaitingCustomer: { label: 'Waiting on you', textClass: 'text-amber-600', pillClass: 'border-amber-200 text-amber-600' },
  WaitingAgent: { label: 'Waiting on support', textClass: 'text-purple-600', pillClass: 'border-purple-200 text-purple-600' },
  Resolved: { label: 'Resolved', textClass: 'text-emerald-600', pillClass: 'border-emerald-200 text-emerald-600' },
  Closed: { label: 'Closed', textClass: 'text-gray-500', pillClass: 'border-gray-200 text-gray-500' },
};
