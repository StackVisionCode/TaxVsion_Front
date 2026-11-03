import { describe, expect, it } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { parseMailSearchParams, sameMailSearch, toMailSearchParams } from './mail-search-params';
import { MailSearchFilters } from '../data-access/mail.store';

const base: MailSearchFilters = {
  q: '',
  results: false,
  tab: 'all',
  clientId: null,
  hasAttachments: false,
  unread: false,
  notClient: false,
  date: 'any',
  dateFrom: null,
  dateTo: null,
  folder: null,
  from: '',
  to: '',
  subject: '',
  searchFolder: null,
};

describe('Búsqueda de /email en la URL', () => {
  it('con término y sin carpeta es el modo resultados; con `in` busca en esa carpeta', () => {
    expect(
      parseMailSearchParams(convertToParamMap({ q: ' factura ', tab: 'files' })),
    ).toMatchObject({
      q: 'factura',
      results: true,
      tab: 'files',
      folder: null,
    });
    expect(parseMailSearchParams(convertToParamMap({ q: 'factura', in: 'sent' }))).toMatchObject({
      results: false,
      folder: 'sent',
    });
  });

  it('lee los chips y descarta valores desconocidos', () => {
    expect(
      parseMailSearchParams(
        convertToParamMap({ client: 'c1', att: '1', unread: '1', nc: '1', date: '7d', in: 'nope' }),
      ),
    ).toEqual({
      ...base,
      clientId: 'c1',
      hasAttachments: true,
      unread: true,
      notClient: false,
      date: '7d',
    });
    expect(parseMailSearchParams(convertToParamMap({ nc: '1', date: '99d' }))).toEqual({
      ...base,
      notClient: true,
    });
  });

  it('escribe solo lo que no es el valor por defecto (null borra la clave)', () => {
    expect(
      toMailSearchParams({ ...base, q: 'w-2', results: true, tab: 'files', hasAttachments: true }),
    ).toEqual({
      q: 'w-2',
      in: null,
      tab: 'files',
      client: null,
      att: '1',
      unread: null,
      nc: null,
      date: null,
      since: null,
      until: null,
      from: null,
      rcpt: null,
      subject: null,
      folder: null,
    });
    expect(toMailSearchParams({ ...base, q: 'w-2', folder: 'trash' }).in).toBe('trash');
    // Sin término no hay carpeta en la URL (la carpeta sin búsqueda nunca vivió ahí).
    expect(toMailSearchParams({ ...base, folder: 'trash', notClient: true })).toMatchObject({
      in: null,
      nc: '1',
    });
  });

  it('ida y vuelta: lo escrito se vuelve a leer igual', () => {
    const state: MailSearchFilters = {
      ...base,
      q: 'factura',
      folder: 'drafts',
      clientId: 'c1',
      unread: true,
      date: '30d',
    };
    const written = toMailSearchParams(state);
    const params = convertToParamMap(
      Object.fromEntries(Object.entries(written).filter(([, value]) => value !== null)),
    );
    expect(sameMailSearch(parseMailSearchParams(params), state)).toBe(true);
  });

  it('sin `tab` es All; un `tab` desconocido también', () => {
    expect(parseMailSearchParams(convertToParamMap({ q: 'w-2' })).tab).toBe('all');
    expect(parseMailSearchParams(convertToParamMap({ q: 'w-2', tab: 'events' })).tab).toBe('all');
    expect(parseMailSearchParams(convertToParamMap({ q: 'w-2', tab: 'people' })).tab).toBe('people');
    expect(toMailSearchParams({ ...base, q: 'w-2', results: true, tab: 'all' }).tab).toBeNull();
  });

  it('filtros de campo: sin `q` también es modo resultados (B1); con `in` se ignoran', () => {
    expect(
      parseMailSearchParams(convertToParamMap({ from: 'ana@x.com', rcpt: 'bob', subject: 'w-2', folder: 'sent' })),
    ).toEqual({
      ...base,
      results: true,
      from: 'ana@x.com',
      to: 'bob',
      subject: 'w-2',
      searchFolder: 'sent',
    });
    expect(parseMailSearchParams(convertToParamMap({ q: 'w-2', in: 'inbox', from: 'ana' }))).toMatchObject({
      results: false,
      from: '',
      searchFolder: null,
    });
    // Un texto de 1 letra no es criterio válido (400 en el backend).
    expect(parseMailSearchParams(convertToParamMap({ from: 'a' })).results).toBe(false);
    // Fuera del modo resultados no se escriben.
    expect(toMailSearchParams({ ...base, from: 'ana', searchFolder: 'sent' })).toMatchObject({ from: null, folder: null });
  });

  it('rango personalizado: `since`/`until` válidos; sin ninguno vuelve a Any time', () => {
    expect(
      parseMailSearchParams(convertToParamMap({ date: 'custom', since: '2026-10-01', until: '2026-10-31' })),
    ).toMatchObject({ date: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(parseMailSearchParams(convertToParamMap({ date: 'custom', since: 'ayer' }))).toMatchObject({
      date: 'any',
      dateFrom: null,
    });
    expect(parseMailSearchParams(convertToParamMap({ date: '7d', since: '2026-10-01' })).dateFrom).toBeNull();
    expect(toMailSearchParams({ ...base, date: 'custom', dateFrom: '2026-10-01', dateTo: null })).toMatchObject({
      date: 'custom',
      since: '2026-10-01',
      until: null,
    });
  });

  it('ida y vuelta con filtros de campo, pestaña y rango', () => {
    const state: MailSearchFilters = {
      ...base,
      q: 'factura',
      results: true,
      tab: 'people',
      from: 'ana perez',
      to: 'bob@y.com',
      subject: 'w-2',
      searchFolder: 'archived',
      date: 'custom',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    };
    const written = toMailSearchParams(state);
    const params = convertToParamMap(
      Object.fromEntries(Object.entries(written).filter(([, value]) => value !== null)),
    );
    expect(parseMailSearchParams(params)).toEqual(state);
  });
});
