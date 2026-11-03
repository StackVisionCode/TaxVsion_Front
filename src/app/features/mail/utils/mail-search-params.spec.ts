import { describe, expect, it } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { parseMailSearchParams, sameMailSearch, toMailSearchParams } from './mail-search-params';
import { MailSearchFilters } from '../data-access/mail.store';

const base: MailSearchFilters = {
  q: '',
  results: false,
  tab: 'emails',
  clientId: null,
  hasAttachments: false,
  unread: false,
  notClient: false,
  date: 'any',
  folder: null,
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
});
