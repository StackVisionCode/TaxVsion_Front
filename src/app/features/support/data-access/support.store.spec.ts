import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SupportService } from './support.service';
import { SupportStore } from './support.store';
import type { SupportTicket } from './support.model';

const ticket = (id: string, over: Partial<SupportTicket> = {}): SupportTicket => ({
  id,
  tenantId: 'tn',
  agentTenantId: 'pt',
  openedByUserId: 'me',
  assignedAgentId: null,
  conversationId: `conv-${id}`,
  subject: `Ticket ${id}`,
  category: 'Technical',
  priority: 'Normal',
  status: 'Open',
  openedAtUtc: '2026-10-02T10:00:00Z',
  claimedAtUtc: null,
  resolvedAtUtc: null,
  closedAtUtc: null,
  unreadCount: 0,
  lastMessage: null,
  ...over,
});

function setup(tickets: SupportTicket[]) {
  const service = { listMyTickets: vi.fn(() => of({ items: tickets, page: 1, size: 50, totalCount: tickets.length })) };
  TestBed.configureTestingModule({ providers: [{ provide: SupportService, useValue: service }] });
  const store = TestBed.inject(SupportStore);
  store.loadTickets();
  return store;
}

/** Bandeja de Support: qué ticket trae el mensaje nuevo y cómo baja al leerlo. */
describe('SupportStore', () => {
  it('los tickets con mensajes nuevos van arriba; el resto por última actividad', () => {
    const store = setup([
      ticket('old', { lastMessage: { fromMe: true, kind: 'Text', preview: 'a', isDeleted: false, createdAtUtc: '2026-10-05T10:00:00Z' } }),
      ticket('recent', { lastMessage: { fromMe: true, kind: 'Text', preview: 'b', isDeleted: false, createdAtUtc: '2026-10-30T10:00:00Z' } }),
      ticket('news', { unreadCount: 1, lastMessage: { fromMe: false, kind: 'Text', preview: 'c', isDeleted: false, createdAtUtc: '2026-10-03T10:00:00Z' } }),
    ]);

    expect(store.visibleTickets().map(t => t.id)).toEqual(['news', 'recent', 'old']);
  });

  it('separa Active y Closed con sus contadores y no leídos', () => {
    const store = setup([ticket('a', { unreadCount: 2 }), ticket('c', { status: 'Closed', unreadCount: 1 }), ticket('r', { status: 'Resolved' })]);

    expect(store.activeCount()).toBe(1);
    expect(store.closedCount()).toBe(2);
    expect(store.activeUnread()).toBe(2);
    expect(store.closedUnread()).toBe(1);
    store.setFilter('closed');
    expect(store.visibleTickets().map(t => t.id).sort()).toEqual(['c', 'r']);
  });

  it('abrir un ticket lo da por leído y devuelve cuántos tenía (para la burbuja)', () => {
    const store = setup([ticket('a', { unreadCount: 3 })]);

    expect(store.selectTicket(store.tickets()[0]!)).toBe(3);
    expect(store.tickets()[0]!.unreadCount).toBe(0);
  });

  it('un mensaje de soporte en un ticket que no se mira suma a su fila; el abierto no', () => {
    const store = setup([ticket('a'), ticket('b')]);
    store.selectTicket(store.tickets()[1]!);
    const at = '2026-10-31T18:00:00Z';

    store.applyActivity({ conversationId: 'conv-a', fromMe: false, kind: 'Text', body: 'We fixed it', createdAtUtc: at, viewing: false });
    store.applyActivity({ conversationId: 'conv-b', fromMe: false, kind: 'Text', body: 'Still there?', createdAtUtc: at, viewing: true });
    store.applyActivity({ conversationId: 'conv-a', fromMe: true, kind: 'Text', body: 'Thanks', createdAtUtc: at, viewing: false });

    const [a, b] = store.tickets();
    expect(a!.unreadCount).toBe(1);
    expect(a!.lastMessage).toMatchObject({ fromMe: true, preview: 'Thanks' });
    expect(b!.unreadCount).toBe(0);
  });
});
