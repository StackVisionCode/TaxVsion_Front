import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChatStore } from '@features/chat/data-access/chat.store';
import { SupportStore } from '../../data-access/support.store';
import type { SupportTicket } from '../../data-access/support.model';
import { SupportPageComponent } from './support-page.component';

const ticket = (overrides: Partial<SupportTicket> = {}): SupportTicket => ({
  id: 't1',
  tenantId: 'tn',
  agentTenantId: 'pt',
  openedByUserId: 'me',
  assignedAgentId: null,
  conversationId: 'conv-t1',
  subject: 'Billing question',
  category: 'Billing',
  priority: 'Normal',
  status: 'Open',
  openedAtUtc: '2026-10-31T10:00:00Z',
  claimedAtUtc: null,
  resolvedAtUtc: null,
  closedAtUtc: null,
  ...overrides,
} as SupportTicket);

function setup(queryTicket: string | null = null) {
  const selected = signal<SupportTicket | null>(null);
  const support = {
    loadTickets: vi.fn(),
    applyActivity: vi.fn(),
    ticketCreated$: new Subject<{ ticketId: string; conversationId: string }>(),
    selectedTicket: selected.asReadonly(),
    selectTicket: vi.fn((t: SupportTicket | null) => {
      selected.set(t);
      return t ? 2 : 0;
    }),
    selectTicketById: vi.fn(),
  };
  const supportActivity$ = new Subject<unknown>();
  const chat = { openEmbedded: vi.fn(), closeEmbedded: vi.fn(), noteSupportRead: vi.fn(), embeddedConversation: signal(null), supportActivity$ };
  TestBed.configureTestingModule({
    providers: [
      { provide: SupportStore, useValue: support },
      { provide: ChatStore, useValue: chat },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryTicket ? { ticket: queryTicket } : {}) } } },
    ],
  });
  TestBed.overrideComponent(SupportPageComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(SupportPageComponent);
  fixture.detectChanges();
  return { fixture, support, chat, supportActivity$, component: fixture.componentInstance };
}

describe('SupportPageComponent — bandeja de tickets', () => {
  it('abrir un ticket muestra su chat al lado y baja la burbuja lo que tenía sin leer', () => {
    const { fixture, support, chat, component } = setup();
    component.openTicket(ticket());
    fixture.detectChanges();
    TestBed.flushEffects();

    expect(support.selectTicket).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    expect(chat.openEmbedded).toHaveBeenCalledWith('conv-t1', 'Billing question');
    expect(chat.noteSupportRead).toHaveBeenCalledWith(2);
  });

  it('volver a la lista cierra la conversación embebida', () => {
    const { fixture, chat, component } = setup();
    component.openTicket(ticket());
    TestBed.flushEffects();
    component.backToList();
    fixture.detectChanges();
    TestBed.flushEffects();

    expect(chat.closeEmbedded).toHaveBeenCalledWith('conv-t1');
  });

  it('el deep link ?ticket= (p. ej. redirigido desde /chat) selecciona ese ticket', () => {
    const { support } = setup('t-9');
    expect(support.selectTicketById).toHaveBeenCalledWith('t-9', expect.any(Function));
  });

  it('cada mensaje de un ticket que llega en vivo actualiza su fila', () => {
    const { support, supportActivity$ } = setup();
    const activity = { conversationId: 'conv-t1', fromMe: false, kind: 'Text', body: 'Hi', createdAtUtc: '2026-10-31T18:00:00Z', viewing: false };
    supportActivity$.next(activity);
    expect(support.applyActivity).toHaveBeenCalledWith(activity);
  });
});
