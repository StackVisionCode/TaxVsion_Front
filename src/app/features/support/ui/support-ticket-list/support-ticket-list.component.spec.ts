import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { SupportTicket } from '../../data-access/support.model';
import { SupportTicketListComponent } from './support-ticket-list.component';

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
  ...over,
});

/** Columna de la bandeja: se ve qué ticket trae el mensaje nuevo. */
describe('SupportTicketListComponent', () => {
  function render(inputs: Partial<SupportTicketListComponent>): HTMLElement {
    const fixture = TestBed.createComponent(SupportTicketListComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('la fila con mensajes nuevos muestra su contador y la vista previa de soporte', () => {
    const el = render({
      tickets: [
        ticket('news', { unreadCount: 2, lastMessage: { fromMe: false, kind: 'Text', preview: 'We fixed it', isDeleted: false, createdAtUtc: '2026-10-31T17:39:00Z' } }),
        ticket('quiet', { unreadCount: 0 }),
      ],
    });

    const rows = el.querySelectorAll('[data-role="ticket-row"]');
    expect(rows[0]!.querySelector('[data-role="ticket-unread"]')?.textContent?.trim()).toBe('2');
    expect(rows[0]!.querySelector('[data-role="ticket-preview"]')?.textContent?.trim()).toBe('Support: We fixed it');
    expect(rows[1]!.querySelector('[data-role="ticket-unread"]')).toBeNull();
    expect(rows[1]!.querySelector('[data-role="ticket-preview"]')?.textContent?.trim()).toBe('No messages yet');
  });

  it('la pestaña que no se mira avisa con un punto si tiene mensajes nuevos', () => {
    const el = render({ filter: 'active', activeUnread: 0, closedUnread: 1 });

    expect(el.querySelector('[data-role="tab-closed"] [aria-label="New messages"]')).not.toBeNull();
    expect(el.querySelector('[data-role="tab-active"] [aria-label="New messages"]')).toBeNull();
  });
});
