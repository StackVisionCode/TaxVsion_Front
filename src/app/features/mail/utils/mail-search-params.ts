import { ParamMap } from '@angular/router';
import {
  MailDateFilter,
  MailFolderId,
  MailSearchFilters,
  MailSearchTab,
} from '../data-access/mail.store';

/**
 * Búsqueda y chips de /email en la URL (atrás/adelante y recargar funcionan):
 * `q` término · `in` carpeta donde se busca (sin `in` y con `q` = modo resultados, todas las carpetas) ·
 * `tab=files` · `client` id del cliente · `att=1` adjuntos · `unread=1` · `nc=1` Not a client · `date=7d|30d`.
 * Nombres propios (no `customerId`/`threadId`): esos los usan los deep links de notificación y compose.
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
] as const;

const FOLDERS: ReadonlySet<string> = new Set<MailFolderId>([
  'inbox',
  'sent',
  'archived',
  'drafts',
  'trash',
]);

export function parseMailSearchParams(params: Pick<ParamMap, 'get'>): MailSearchFilters {
  const q = (params.get('q') ?? '').trim().slice(0, 200);
  const folderParam = params.get('in');
  const folder = folderParam && FOLDERS.has(folderParam) ? (folderParam as MailFolderId) : null;
  const date = params.get('date');
  const client = params.get('client');
  return {
    q,
    results: q.length > 0 && folder === null,
    tab: (params.get('tab') === 'files' ? 'files' : 'emails') as MailSearchTab,
    clientId: client || null,
    hasAttachments: params.get('att') === '1',
    unread: params.get('unread') === '1',
    // Cliente y "Not a client" son excluyentes: manda el cliente.
    notClient: !client && params.get('nc') === '1',
    date: (date === '7d' || date === '30d' ? date : 'any') as MailDateFilter,
    folder: q ? folder : null,
  };
}

/** Query params para `router.navigate(..., { queryParamsHandling: 'merge' })`: null borra la clave. */
export function toMailSearchParams(
  state: MailSearchFilters,
): Record<(typeof MAIL_SEARCH_PARAM_KEYS)[number], string | null> {
  const q = state.q.trim();
  return {
    q: q || null,
    in: q && !state.results ? state.folder : null,
    tab: q && state.results && state.tab === 'files' ? 'files' : null,
    client: state.clientId,
    att: state.hasAttachments ? '1' : null,
    unread: state.unread ? '1' : null,
    nc: !state.clientId && state.notClient ? '1' : null,
    date: state.date === 'any' ? null : state.date,
  };
}

/** ¿Dos estados dan la misma URL? (evita navegar a lo mismo). */
export function sameMailSearch(a: MailSearchFilters, b: MailSearchFilters): boolean {
  const left = toMailSearchParams(a);
  const right = toMailSearchParams(b);
  return MAIL_SEARCH_PARAM_KEYS.every((key) => left[key] === right[key]);
}
