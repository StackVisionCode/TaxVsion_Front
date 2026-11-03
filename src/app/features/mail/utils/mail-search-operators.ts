/**
 * Operadores del buscador de Mail (estilo Outlook/Gmail): `from:` `to:` `subject:`
 * `in:sent|inbox|archived|drafts|trash` `has:attachment` `is:unread`. Los valores admiten comillas
 * (`from:"ana perez"`). Lo que no es operador queda como texto libre (`q`). Funciones puras.
 */

/** Carpeta de un `in:` (mismos ids que el rail de Mail). */
export type MailOperatorFolder = 'inbox' | 'sent' | 'archived' | 'drafts' | 'trash';

/** Criterios que se pueden escribir como operadores. Texto vacío / null = sin ese filtro. */
export interface MailSearchCriteria {
  q: string;
  from: string;
  to: string;
  subject: string;
  folder: MailOperatorFolder | null;
  hasAttachments: boolean;
  unread: boolean;
}

export const EMPTY_MAIL_CRITERIA: Readonly<MailSearchCriteria> = {
  q: '',
  from: '',
  to: '',
  subject: '',
  folder: null,
  hasAttachments: false,
  unread: false,
};

const FOLDER_ALIASES: Readonly<Record<string, MailOperatorFolder>> = {
  inbox: 'inbox',
  sent: 'sent',
  archived: 'archived',
  archive: 'archived',
  drafts: 'drafts',
  draft: 'drafts',
  trash: 'trash',
  deleted: 'trash',
};

const OPERATOR = /^(from|to|subject|in|has|is):/i;

interface Token {
  /** Texto tal cual (para devolverlo a `q` si no es un operador válido). */
  raw: string;
  key: string | null;
  value: string;
}

/** Parte el texto en tokens respetando comillas (`from:"ana perez"`, `"tax return"`). */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const text = input ?? '';
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    const start = i;
    const head = OPERATOR.exec(text.slice(i));
    let key: string | null = null;
    if (head) {
      key = head[1].toLowerCase();
      i += head[0].length;
    }
    let value = '';
    if (text[i] === '"') {
      const close = text.indexOf('"', i + 1);
      const end = close < 0 ? text.length : close;
      value = text.slice(i + 1, end);
      i = close < 0 ? text.length : close + 1;
    } else {
      const begin = i;
      while (i < text.length && !/\s/.test(text[i])) i++;
      value = text.slice(begin, i);
    }
    tokens.push({ raw: text.slice(start, i), key, value: value.trim() });
  }
  return tokens;
}

/**
 * Convierte el texto del buscador en criterios. Un operador repetido: gana el último. Un operador
 * vacío (`from:`) se descarta; uno con valor desconocido (`in:spam`, `is:starred`) queda como texto.
 */
export function parseMailSearchOperators(input: string): MailSearchCriteria {
  const result: MailSearchCriteria = { ...EMPTY_MAIL_CRITERIA };
  const free: string[] = [];
  for (const token of tokenize(input)) {
    const value = token.value;
    switch (token.key) {
      case 'from':
      case 'to':
      case 'subject':
        if (value) result[token.key] = value;
        break;
      case 'in': {
        const folder = FOLDER_ALIASES[value.toLowerCase()];
        if (folder) result.folder = folder;
        else if (value) free.push(token.raw);
        break;
      }
      case 'has':
        if (/^attachments?$/i.test(value)) result.hasAttachments = true;
        else if (value) free.push(token.raw);
        break;
      case 'is':
        if (/^unread$/i.test(value)) result.unread = true;
        else if (value) free.push(token.raw);
        break;
      default:
        // Texto libre: una frase entre comillas pierde las comillas.
        if (value) free.push(value);
    }
  }
  result.q = free.join(' ').replace(/\s+/g, ' ').trim();
  return result;
}

/** ¿El texto trae algún operador reconocido? (para decidir si convertir a chips). */
export function hasMailSearchOperators(input: string): boolean {
  const parsed = parseMailSearchOperators(input);
  return (
    !!parsed.from ||
    !!parsed.to ||
    !!parsed.subject ||
    parsed.folder !== null ||
    parsed.hasAttachments ||
    parsed.unread
  );
}

function quoted(value: string): string {
  const clean = value.replace(/"/g, '').trim();
  return /\s/.test(clean) || clean === '' ? `"${clean}"` : clean;
}

/** Forma canónica en texto (búsquedas recientes): operadores primero y luego el texto libre. */
export function formatMailSearchOperators(criteria: Partial<MailSearchCriteria>): string {
  const parts: string[] = [];
  if (criteria.from?.trim()) parts.push(`from:${quoted(criteria.from)}`);
  if (criteria.to?.trim()) parts.push(`to:${quoted(criteria.to)}`);
  if (criteria.subject?.trim()) parts.push(`subject:${quoted(criteria.subject)}`);
  if (criteria.folder) parts.push(`in:${criteria.folder}`);
  if (criteria.hasAttachments) parts.push('has:attachment');
  if (criteria.unread) parts.push('is:unread');
  const q = criteria.q?.trim();
  if (q) parts.push(q);
  return parts.join(' ');
}
