import { applyConversationUpdate, applyRoleChange, canWriteInGroup, groupErrorMessage, memberActions } from './chat-groups';
import type { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';

/** F8b — reglas de grupo del CRM: qué acciones ofrecer y cómo aplicar los eventos en vivo. */
describe('chat-groups', () => {
  const conv = (over: Partial<ChatConversation> = {}): ChatConversation => ({
    id: 'g1',
    name: 'Tax team',
    kind: 'Group',
    peerUserId: null,
    avatarColor: 'bg-x',
    participants: [
      { userId: 'me', displayName: 'Me', role: 'Admin', actorType: 'TenantEmployee' },
      { userId: 'ana', displayName: 'Ana', role: 'Owner', actorType: 'TenantEmployee' },
      { userId: 'cli', displayName: 'Client', role: 'Member', actorType: 'CustomerPortal' },
    ],
    presence: 'Offline',
    busyReason: null,
    typingName: null,
    recordingName: null,
    hasMoreHistory: false,
    unread: 0,
    messages: [],
    myRole: 'Admin',
    ...over,
  });

  it('memberActions: el Admin saca Members; solo el Owner nombra admins, transfiere y saca admins; clientes nunca admin', () => {
    const admin = { userId: 'me', role: 'Admin' as const, superpower: false };
    expect(memberActions(admin, { userId: 'x', role: 'Member', actorType: 'TenantEmployee' })).toEqual({
      makeAdmin: false, removeAdmin: false, makeOwner: false, remove: true,
    });
    expect(memberActions(admin, { userId: 'y', role: 'Admin' }).remove).toBe(false);
    const owner = { userId: 'me', role: 'Owner' as const, superpower: false };
    expect(memberActions(owner, { userId: 'x', role: 'Member', actorType: 'TenantEmployee' })).toEqual({
      makeAdmin: true, removeAdmin: false, makeOwner: true, remove: true,
    });
    expect(memberActions(owner, { userId: 'c', role: 'Member', actorType: 'CustomerPortal' })).toMatchObject({ makeAdmin: false, makeOwner: false, remove: true });
    expect(memberActions(owner, { userId: 'ana', role: 'Owner' }).remove).toBe(false);
    expect(memberActions({ userId: 'me', role: null, superpower: true }, { userId: 'y', role: 'Admin' }).removeAdmin).toBe(true);
  });

  it('canWriteInGroup: en modo anuncio solo Owner/Admin', () => {
    expect(canWriteInGroup({ kind: 'Group', adminsOnlyWrite: true, myRole: 'Member' })).toBe(false);
    expect(canWriteInGroup({ kind: 'Group', adminsOnlyWrite: true, myRole: 'Admin' })).toBe(true);
    expect(canWriteInGroup({ kind: 'Direct', adminsOnlyWrite: true, myRole: null })).toBe(true);
  });

  it('applyRoleChange actualiza al miembro y mi rol cuando soy yo', () => {
    const next = applyRoleChange(conv(), { conversationId: 'g1', userId: 'me', role: 'Owner', changedByUserId: null, changedAtUtc: '' }, 'me');
    expect(next.myRole).toBe('Owner');
    expect(next.participants?.find(p => p.userId === 'me')?.role).toBe('Owner');
  });

  it('applyConversationUpdate solo toca los campos presentes', () => {
    const next = applyConversationUpdate(conv({ description: 'old' }), { conversationId: 'g1', kind: 'Group', title: 'New', adminsOnlyWrite: true, isMuted: true });
    expect([next.name, next.description, next.adminsOnlyWrite, next.isMuted]).toEqual(['New', 'old', true, true]);
  });

  it('groupErrorMessage traduce códigos sin filtrar detalles', () => {
    expect(groupErrorMessage('Chat.Member.SingleClientOnly')).toContain('Only one client');
    expect(groupErrorMessage('Chat.EmployeeToEmployeeDisabled')).toContain('between employees');
    expect(groupErrorMessage('Something.Internal')).toBe('Something went wrong. Please try again.');
  });
});
