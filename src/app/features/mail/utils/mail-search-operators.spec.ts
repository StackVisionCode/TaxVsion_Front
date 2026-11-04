import { describe, expect, it } from 'vitest';
import {
  EMPTY_MAIL_CRITERIA,
  formatMailSearchOperators,
  hasMailSearchOperators,
  parseMailSearchOperators,
} from './mail-search-operators';

describe('parseMailSearchOperators', () => {
  it('sin operadores todo es texto libre (espacios normalizados)', () => {
    expect(parseMailSearchOperators('  w-2   2025 ')).toEqual({ ...EMPTY_MAIL_CRITERIA, q: 'w-2 2025' });
  });

  it('reconoce cada operador y deja el resto como q', () => {
    expect(
      parseMailSearchOperators('from:ana@x.com to:bob@y.com subject:factura in:sent has:attachment is:unread octubre'),
    ).toEqual({
      q: 'octubre',
      from: 'ana@x.com',
      to: 'bob@y.com',
      subject: 'factura',
      folder: 'sent',
      hasAttachments: true,
      unread: true,
    });
  });

  it('admite comillas en los valores y en frases libres', () => {
    const parsed = parseMailSearchOperators('from:"ana perez" subject:"tax return 2025" "w 2"');
    expect(parsed.from).toBe('ana perez');
    expect(parsed.subject).toBe('tax return 2025');
    expect(parsed.q).toBe('w 2');
  });

  it('una comilla sin cerrar llega hasta el final', () => {
    expect(parseMailSearchOperators('from:"ana perez').from).toBe('ana perez');
  });

  it('las claves no distinguen mayúsculas y el último operador repetido gana', () => {
    const parsed = parseMailSearchOperators('FROM:a@x.com from:b@x.com IN:Inbox HAS:Attachments IS:UNREAD');
    expect(parsed.from).toBe('b@x.com');
    expect(parsed.folder).toBe('inbox');
    expect(parsed.hasAttachments).toBe(true);
    expect(parsed.unread).toBe(true);
  });

  it('acepta alias de carpeta (archive, draft, deleted)', () => {
    expect(parseMailSearchOperators('in:archive').folder).toBe('archived');
    expect(parseMailSearchOperators('in:draft').folder).toBe('drafts');
    expect(parseMailSearchOperators('in:deleted').folder).toBe('trash');
  });

  it('un operador con valor desconocido queda como texto; uno vacío se descarta', () => {
    const parsed = parseMailSearchOperators('in:spam is:starred has:link from: factura');
    expect(parsed.folder).toBeNull();
    expect(parsed.unread).toBe(false);
    expect(parsed.hasAttachments).toBe(false);
    expect(parsed.from).toBe('');
    expect(parsed.q).toBe('in:spam is:starred has:link factura');
  });

  it('solo cuenta como operador al inicio de una palabra (email:x, https://)', () => {
    const parsed = parseMailSearchOperators('email:x@y.com https://from:z');
    expect(parsed.from).toBe('');
    expect(parsed.q).toBe('email:x@y.com https://from:z');
  });

  it('texto vacío o nulo da criterios vacíos', () => {
    expect(parseMailSearchOperators('')).toEqual(EMPTY_MAIL_CRITERIA);
    expect(parseMailSearchOperators(null as unknown as string)).toEqual(EMPTY_MAIL_CRITERIA);
  });
});

describe('hasMailSearchOperators', () => {
  it('detecta operadores reconocidos y no los inválidos', () => {
    expect(hasMailSearchOperators('factura')).toBe(false);
    expect(hasMailSearchOperators('in:spam')).toBe(false);
    expect(hasMailSearchOperators('is:unread')).toBe(true);
    expect(hasMailSearchOperators('from:"a b"')).toBe(true);
  });
});

describe('formatMailSearchOperators', () => {
  it('escribe operadores primero, cita lo que tiene espacios y vuelve a parsear igual', () => {
    const criteria = {
      q: 'octubre',
      from: 'ana perez',
      to: 'bob@y.com',
      subject: 'tax return',
      folder: 'archived' as const,
      hasAttachments: true,
      unread: true,
    };
    const text = formatMailSearchOperators(criteria);
    expect(text).toBe('from:"ana perez" to:bob@y.com subject:"tax return" in:archived has:attachment is:unread octubre');
    expect(parseMailSearchOperators(text)).toEqual(criteria);
  });

  it('solo texto libre = el texto tal cual; nada = vacío', () => {
    expect(formatMailSearchOperators({ q: ' w-2 ' })).toBe('w-2');
    expect(formatMailSearchOperators({})).toBe('');
  });
});
