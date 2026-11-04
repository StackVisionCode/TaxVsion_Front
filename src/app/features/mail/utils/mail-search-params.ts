import { ParamMap } from '@angular/router';
import {
  MailDateFilter,
  MailFolderId,
  MailSearchFilters,
  MailSearchTab,
  hasValidSearchCriteria,
} from '../data-access/mail.store';
import { isValidDay } from './mail-search-dates';

/**
 * Búsqueda y chips de /email en la URL (atrás/adelante y recargar funcionan):
 * `q` término · `in` carpeta donde se busca (sin `in` y con criterio = modo resultados, todas las carpetas) ·
 * `tab=emails|people|files` (sin `tab` = All) · `client` id del cliente · `att=1` adjuntos · `unread=1` ·
 * `nc=1` Not a client · `date=7d|30d|90d|custom` (+ `since`/`until` `YYYY-MM-DD`) · modo resultados:
 * `from`, `rcpt` (To), `subject`, `folder` (carpeta como filtro).
 * Nombres propios (no `customerId`/`threadId`/`to`): esos los usan los deep links de notificación y compose.
 */
export const MAIL_SEARCH_PARAM_KEYS = [
  'q',
  'in',
  'tab',
  'client',
  'att',
  'unread',
  'nc',
  'date',
  'since',
  'until',
  'from',
  'rcpt',
  'subject',
  'folder',
] as const;

const FOLDERS: ReadonlySet<string> = new Set<MailFolderId>(['inbox', 'sent', 'archived', 'drafts', 'trash']);
const TABS: ReadonlySet<string> = new Set<MailSearchTab>(['emails', 'people', 'files']);
const DATES: ReadonlySet<string> = new Set<MailDateFilter>(['7d', '30d', '90d', 'custom']);

function folderOf(value: string | null): MailFolderId | null {
  return value && FOLDERS.has(value) ? (value as MailFolderId) : null;
}

function text(params: Pick<ParamMap, 'get'>, key: string): string {
  return (params.get(key) ?? '').trim().slice(0, 200);
}

export function parseMailSearchParams(params: Pick<ParamMap, 'get'>): MailSearchFilters {
  const q = text(params, 'q');
  const folder = folderOf(params.get('in'));
  const dateParam = params.get('date');
  let date = (dateParam && DATES.has(dateParam) ? dateParam : 'any') as MailDateFilter;
  const since = params.get('since');
  const until = params.get('until');
  const dateFrom = date === 'custom' && isValidDay(since) ? since : null;
  const dateTo = date === 'custom' && isValidDay(until) ? until : null;
  if (date === 'custom' && !dateFrom && !dateTo) {
    date = 'any';
  }
  const client = params.get('client');
  // Los filtros de campo solo existen en el modo resultados (sin `in`).
  const fields = folder
    ? { from: '', to: '', subject: '' }
    : { from: text(params, 'from'), to: text(params, 'rcpt'), subject: text(params, 'subject') };
  const tab = params.get('tab');
  return {
    q,
    results: folder === null && hasValidSearchCriteria({ q, ...fields }),
    tab: (tab && TABS.has(tab) ? tab : 'all') as MailSearchTab,
    clientId: client || null,
    hasAttachments: params.get('att') === '1',
    unread: params.get('unread') === '1',
    // Cliente y "Not a client" son excluyentes: manda el cliente.
    notClient: !client && params.get('nc') === '1',
    date,
    dateFrom,
    dateTo,
    folder: q ? folder : null,
    ...fields,
    searchFolder: folder ? null : folderOf(params.get('folder')),
  };
}

/** Query params para `router.navigate(..., { queryParamsHandling: 'merge' })`: null borra la clave. */
export function toMailSearchParams(
  state: MailSearchFilters,
): Record<(typeof MAIL_SEARCH_PARAM_KEYS)[number], string | null> {
  const q = state.q.trim();
  const results = state.results;
  const custom = state.date === 'custom';
  const field = (value: string | null | undefined) => (results && value?.trim() ? value.trim() : null);
  return {
    q: q || null,
    in: q && !results ? state.folder : null,
    tab: results && state.tab !== 'all' ? state.tab : null,
    client: state.clientId,
    att: state.hasAttachments ? '1' : null,
    unread: state.unread ? '1' : null,
    nc: !state.clientId && state.notClient ? '1' : null,
    date: state.date === 'any' ? null : state.date,
    since: custom ? state.dateFrom : null,
    until: custom ? state.dateTo : null,
    from: field(state.from),
    rcpt: field(state.to),
    subject: field(state.subject),
    folder: results ? state.searchFolder : null,
  };
}

/** ¿Dos estados dan la misma URL? (evita navegar a lo mismo). */
export function sameMailSearch(a: MailSearchFilters, b: MailSearchFilters): boolean {
  const left = toMailSearchParams(a);
  const right = toMailSearchParams(b);
  return MAIL_SEARCH_PARAM_KEYS.every((key) => left[key] === right[key]);
}
