import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { ChatStore } from '../../data-access/chat.store';
import { ChatService } from '../../data-access/chat.service';
import { ChatGroupAdminService } from '../../data-access/chat-group-admin.service';
import type { ChatConversation } from '../chat-conversation-list/chat-conversation-list.component';
import { GroupInfoPanelComponent } from './group-info-panel.component';

/** F8b — Info del grupo: acciones según mi rol, alta de miembros, bitácora y salir. */
describe('GroupInfoPanelComponent', () => {
  const group = (over: Partial<ChatConversation> = {}): ChatConversation => ({
    id: 'g1',
    name: 'Tax team',
    kind: 'Group',
    peerUserId: null,
    avatarColor: 'bg-x',
    participants: [
      { userId: 'me', displayName: 'Me', role: 'Owner', actorType: 'TenantEmployee' },
      { userId: 'ana', displayName: 'Ana', role: 'Member', actorType: 'TenantEmployee' },
      { userId: 'cli', displayName: 'Diego', role: 'Member', actorType: 'CustomerPortal' },
    ],
    presence: 'Offline',
    busyReason: null,
    typingName: null,
    recordingName: null,
    hasMoreHistory: false,
    unread: 0,
    messages: [],
    myRole: 'Owner',
    ...over,
  });

  function render(conv: ChatConversation, superpower = false) {
    const admin = {
      busy: signal(false),
      setRole: vi.fn(() => Promise.resolve(true)),
      makeOwner: vi.fn(() => Promise.resolve(true)),
      removeMember: vi.fn(() => Promise.resolve(true)),
      addMember: vi.fn(() => Promise.resolve(true)),
      leave: vi.fn(() => Promise.resolve(true)),
      updateInfo: vi.fn(() => Promise.resolve(true)),
      setAdminsOnly: vi.fn(() => Promise.resolve(true)),
      setMuted: vi.fn(() => Promise.resolve(true)),
    };
    const store = {
      canAdministerAnyGroup: signal(superpower),
      employeeResults: signal([{ userId: 'new', displayName: 'Nora', email: 'n@x.test', isActive: true, actorType: 'TenantEmployee' }, { userId: 'ana', displayName: 'Ana', email: 'a@x.test', isActive: true, actorType: 'TenantEmployee' }]),
      customerResults: signal([]),
      employeeSearchLoading: signal(false),
      searchEmployees: vi.fn(),
      searchCustomers: vi.fn(),
      resetNewConversationState: vi.fn(),
    };
    const chat = {
      getGroupActivity: vi.fn(() =>
        of({ items: [{ id: 'a1', action: 'MemberAdded', actorUserId: 'me', targetUserId: 'ana', metadata: null, occurredAtUtc: '2026-10-31T10:00:00Z' }], nextBeforeUtc: null }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatGroupAdminService, useValue: admin },
        { provide: ChatStore, useValue: store },
        { provide: ChatService, useValue: chat },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
      ],
    });
    const fixture = TestBed.createComponent(GroupInfoPanelComponent);
    fixture.componentRef.setInput('conversation', conv);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, admin };
  }

  const buttonByText = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text);

  it('el Owner ve editar, agregar y modo anuncio; a un cliente no le ofrece "Make admin"', () => {
    const { fixture, el, admin } = render(group());
    expect(el.querySelector('[data-role="group-edit"]')).not.toBeNull();
    expect(el.querySelector('[data-role="group-add"]')).not.toBeNull();
    expect(el.textContent).toContain('Only admins can send messages');

    fixture.componentInstance.toggleMember({ userId: 'cli', displayName: 'Diego', role: 'Member', actorType: 'CustomerPortal' });
    fixture.detectChanges();
    expect(buttonByText(el, 'Make admin')).toBeUndefined();
    buttonByText(el, 'Remove from group')?.click();
    expect(admin.removeMember).toHaveBeenCalledWith('g1', 'cli');

    fixture.componentInstance.toggleMember({ userId: 'ana', displayName: 'Ana', role: 'Member', actorType: 'TenantEmployee' });
    fixture.detectChanges();
    buttonByText(el, 'Make admin')?.click();
    expect(admin.setRole).toHaveBeenCalledWith('g1', 'ana', 'Admin');
  });

  it('un Member no administra: sin editar, sin agregar, sin modo anuncio; sí silenciar y salir (con confirmación)', async () => {
    const { el, admin } = render(group({ myRole: 'Member' }));
    expect(el.querySelector('[data-role="group-edit"]')).toBeNull();
    expect(el.querySelector('[data-role="group-add"]')).toBeNull();
    expect(el.textContent).not.toContain('Only admins can send messages');
    expect(el.textContent).toContain('Mute notifications');

    const leave = el.querySelector<HTMLButtonElement>('[data-role="group-leave"]');
    leave?.click();
    expect(admin.leave).not.toHaveBeenCalled();
    leave?.click();
    await Promise.resolve();
    expect(admin.leave).toHaveBeenCalledWith('g1');
  });

  it('agregar ofrece solo a quien no está en el grupo; la bitácora traduce las acciones', () => {
    const { fixture, el, admin } = render(group());
    fixture.componentInstance.openAdd();
    fixture.detectChanges();
    expect(fixture.componentInstance.candidates.map(c => c.userId)).toEqual(['new']);
    void fixture.componentInstance.add('new');
    expect(admin.addMember).toHaveBeenCalledWith('g1', 'new');

    el.querySelector<HTMLButtonElement>('[data-role="group-activity"]')?.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="group-activity-list"]')?.textContent).toContain('Me added Ana');
  });

  it('el superpoder administra sin ser miembro (y no puede "salir")', () => {
    const { el } = render(group({ myRole: null }), true);
    expect(el.querySelector('[data-role="group-add"]')).not.toBeNull();
    expect(el.querySelector('[data-role="group-leave"]')).toBeNull();
  });
});
