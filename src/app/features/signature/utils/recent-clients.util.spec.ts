import { pushRecentClient, readRecentClients } from './recent-clients.util';
import { WizardClient } from '../ui/signature-request-panel/signature-wizard.model';

function client(partial: Partial<WizardClient> & Pick<WizardClient, 'id'>): WizardClient {
  return {
    displayName: 'Jane Doe',
    email: 'jane@acme.com',
    phone: '555-0100',
    type: 'individual',
    isActive: true,
    createdAt: '2026-01-15',
    ...partial,
  };
}

describe('recent-clients util', () => {
  beforeEach(() => localStorage.clear());

  it('pushRecentClient pone el más nuevo primero y persiste', () => {
    const next = pushRecentClient([], client({ id: 'a' }));
    expect(next.map(c => c.id)).toEqual(['a']);
    expect(readRecentClients().map(c => c.id)).toEqual(['a']);
  });

  it('deduplica y mueve al frente al re-elegir', () => {
    let list: WizardClient[] = [];
    for (const id of ['a', 'b', 'c']) {
      list = pushRecentClient(list, client({ id }));
    }
    list = pushRecentClient(list, client({ id: 'b' }));
    expect(list.map(c => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('topa a 5 recientes', () => {
    let list: WizardClient[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      list = pushRecentClient(list, client({ id }));
    }
    expect(list.map(c => c.id)).toEqual(['f', 'e', 'd', 'c', 'b']);
  });

  it('readRecentClients devuelve [] si no hay nada o el JSON está corrupto', () => {
    expect(readRecentClients()).toEqual([]);
    localStorage.setItem('signature.recentClients', '{not json');
    expect(readRecentClients()).toEqual([]);
  });
});
