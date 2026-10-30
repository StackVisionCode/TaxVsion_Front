import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '@shared/services/clipboard.service';
import { MeetingsStore } from '../../data-access/meetings.store';
import { CreatedMeetingInvitation, MeetingInvitationListItem } from '../../data-access/meeting.model';
import { MeetingInvitePanelComponent } from './meeting-invite-panel.component';

function invitation(overrides: Partial<MeetingInvitationListItem> = {}): MeetingInvitationListItem {
  return {
    id: 'i1',
    inviteeKind: 'External',
    inviteeEmail: 'guest@example.com',
    inviteeUserId: null,
    inviteeName: 'Guest One',
    expiresAt: '2999-01-01T00:00:00Z',
    usedAt: null,
    revokedAt: null,
    createdAt: '2026-10-30T11:00:00Z',
    ...overrides,
  };
}

function render(list: MeetingInvitationListItem[] = []) {
  const store = {
    listInvitations: vi.fn().mockReturnValue(of(list)),
    createInvitations: vi.fn(),
    revokeInvitation: vi.fn().mockReturnValue(of(undefined)),
    searchInvitees: vi.fn().mockReturnValue(of({ employees: [], customers: [] })),
  };
  const clipboard = { copy: vi.fn().mockResolvedValue(true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeetingsStore, useValue: store },
      { provide: ClipboardService, useValue: clipboard },
    ],
  });
  const fixture = TestBed.createComponent(MeetingInvitePanelComponent);
  fixture.componentRef.setInput('meetingId', 'm1');
  fixture.componentRef.setInput('shortCode', 'ABC123');
  fixture.componentRef.setInput('isOpen', true);
  fixture.detectChanges();
  // El drawer se porta al <body>.
  const panel = document.querySelector('[role="dialog"]') as HTMLElement;
  return { fixture, store, clipboard, panel, component: fixture.componentInstance };
}

describe('MeetingInvitePanelComponent (F6)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="dialog"]').forEach(n => n.parentElement?.remove());
  });

  it('al abrir lista las invitaciones con su estado y ofrece Revoke solo a las vivas', () => {
    const { panel, store } = render([
      invitation({ id: 'a', inviteeName: 'Active' }),
      invitation({ id: 'u', inviteeName: 'Used', usedAt: '2026-10-30T11:30:00Z' }),
      invitation({ id: 'r', inviteeName: 'Revoked', revokedAt: 'x' }),
      invitation({ id: 'c', inviteeName: 'Closed', closedAt: 'x' }),
      invitation({ id: 'e', inviteeName: 'Expired', expiresAt: '2020-01-01T00:00:00Z' }),
      invitation({ id: 'emp', inviteeKind: 'Employee', inviteeName: 'Emp', useCount: 2 }),
    ]);
    expect(store.listInvitations).toHaveBeenCalledWith('m1');
    const rows = [...panel.querySelectorAll('[data-invitation]')];
    const pill = (id: string) => panel.querySelector(`[data-invitation="${id}"] app-status-pill`)?.textContent?.trim();
    expect(rows).toHaveLength(6);
    expect(pill('a')).toBe('Active');
    expect(pill('u')).toBe('Joined');
    expect(pill('r')).toBe('Revoked');
    expect(pill('c')).toBe('Closed');
    expect(pill('e')).toBe('Expired');
    expect(panel.querySelector('[data-invitation="emp"]')?.textContent).toContain('Joined ×2');
    const revocable = rows.filter(r => r.querySelector('[data-role="revoke"]')).map(r => r.getAttribute('data-invitation'));
    expect(revocable).toEqual(['a', 'u', 'emp']);
  });

  it('agrega un externo con nombre, envía, muestra el link una sola vez y lo copia; Copy code copia el shortCode', async () => {
    const created: CreatedMeetingInvitation[] = [{ id: 'n1', tokenPreview: 'abc…', expiresAt: 'x', inviteeEmail: 'ana@ext.com', joinUrl: 'https://o.taxoffix.io/meet/tok' }];
    const { fixture, panel, store, clipboard, component } = render([]);
    store.createInvitations.mockReturnValue(of(created));

    component.onInviteeSearchChange('ana@ext.com');
    component.externalName.set('Ana');
    component.addExternal();
    fixture.detectChanges();
    expect(component.invitees()).toEqual([{ kind: 'external', userId: null, email: 'ana@ext.com', name: 'Ana' }]);
    expect(panel.querySelector('[data-role="invitee-chips"]')?.textContent).toContain('Ana');

    (panel.querySelector('[data-role="send"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(store.createInvitations).toHaveBeenCalledWith('m1', [{ kind: 'external', userId: null, email: 'ana@ext.com', name: 'Ana' }]);
    expect(component.invitees()).toEqual([]);
    expect(store.listInvitations).toHaveBeenCalledTimes(2); // refresca la lista tras enviar
    const link = panel.querySelector('[data-link="n1"]') as HTMLElement;
    expect(link.textContent).toContain('https://o.taxoffix.io/meet/tok');

    (link.querySelector('[data-role="copy-link"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(clipboard.copy).toHaveBeenCalledWith('https://o.taxoffix.io/meet/tok');

    (panel.querySelector('[data-role="copy-code"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(clipboard.copy).toHaveBeenCalledWith('ABC123');
  });

  it('Revoke llama al DELETE, quita el link recién emitido de esa invitación y recarga', () => {
    const { fixture, panel, store, component } = render([invitation({ id: 'a' })]);
    component.newLinks.set([{ id: 'a', tokenPreview: 'x', expiresAt: 'x', inviteeEmail: null, joinUrl: 'https://x/meet/t' }]);
    fixture.detectChanges();

    (panel.querySelector('[data-invitation="a"] [data-role="revoke"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(store.revokeInvitation).toHaveBeenCalledWith('m1', 'a');
    expect(component.newLinks()).toEqual([]);
    expect(store.listInvitations).toHaveBeenCalledTimes(2);
  });

  it('traduce Meeting.NotJoinable y Meeting.HostOnly a copy propia', () => {
    const { fixture, panel, store, component } = render([]);
    const fail = (code: string) => throwError(() => new HttpErrorResponse({ status: 400, error: { code, message: 'raw' } }));
    component.invitees.set([{ kind: 'external', userId: null, email: 'a@b.co', name: 'a' }]);

    store.createInvitations.mockReturnValue(fail('Meeting.NotJoinable'));
    component.send();
    fixture.detectChanges();
    expect(panel.querySelector('[data-role="error"]')?.textContent).toContain('This meeting has ended');

    store.createInvitations.mockReturnValue(fail('Meeting.HostOnly'));
    component.send();
    fixture.detectChanges();
    expect(panel.querySelector('[data-role="error"]')?.textContent).toContain('Only the host or a co-host');
  });

  it('el picker busca con debounce en el store y agrega empleados/clientes sin duplicar', () => {
    vi.useFakeTimers();
    try {
      const results = new Subject<{ employees: unknown[]; customers: unknown[] }>();
      const { store, component } = render([]);
      store.searchInvitees.mockReturnValue(results);
      component.onInviteeSearchChange('an');
      vi.advanceTimersByTime(250);
      expect(store.searchInvitees).toHaveBeenCalledWith('an');

      component.addEmployee({ userId: 'u1', displayName: 'Ana', email: 'ana@o.com' });
      component.addEmployee({ userId: 'u1', displayName: 'Ana', email: 'ana@o.com' });
      component.addCustomer({ customerId: 'c1', displayName: 'Bob', email: 'bob@c.com' });
      expect(component.invitees().map(i => i.kind)).toEqual(['employee', 'customer']);
      expect(component.inviteeSearch()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
