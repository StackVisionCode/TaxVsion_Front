import { ChatConversation } from '../ui/chat-conversation-list/chat-conversation-list.component';
import { ConversationParticipantRoleChangedDto, ConversationUpdatedDto, GroupRole } from './chat.model';
import { withParticipants } from './chat-participants';

/**
 * F8b: reglas de grupo del lado del CRM (puras, testeables sin el store). El backend manda (D-22); esto solo
 * decide qué acciones mostrar y cómo aplicar los eventos en vivo.
 */

/** Owner o Admin: administran el grupo. */
export function isGroupAdmin(role: GroupRole | null | undefined): boolean {
  return role === 'Owner' || role === 'Admin';
}

export function isClientActor(actorType: string | undefined): boolean {
  return actorType === 'CustomerPortal';
}

/** ¿Puede escribir? En modo anuncio solo Owner/Admin (D-23); el archivado ya lo cubre `isArchived`. */
export function canWriteInGroup(conv: Pick<ChatConversation, 'kind' | 'adminsOnlyWrite' | 'myRole'>): boolean {
  return conv.kind !== 'Group' || !conv.adminsOnlyWrite || isGroupAdmin(conv.myRole);
}

export interface MemberActions {
  makeAdmin: boolean;
  removeAdmin: boolean;
  makeOwner: boolean;
  remove: boolean;
}

/**
 * Acciones sobre un miembro según mi rol (espejo de ADD-05 §13): Owner/Admin sacan Members; solo el Owner (o el
 * superpoder) nombra/quita Admins, transfiere y saca a un Admin. Los clientes nunca administran.
 */
export function memberActions(
  me: { userId: string | null; role: GroupRole | null | undefined; superpower: boolean },
  member: { userId: string; role?: GroupRole; actorType?: string },
): MemberActions {
  const none: MemberActions = { makeAdmin: false, removeAdmin: false, makeOwner: false, remove: false };
  if (member.userId === me.userId || member.role === 'Owner') {
    return none;
  }
  const isOwner = me.role === 'Owner' || me.superpower;
  const isAdmin = isOwner || me.role === 'Admin';
  const client = isClientActor(member.actorType);
  const role = member.role ?? 'Member';
  return {
    makeAdmin: isOwner && !client && role === 'Member',
    removeAdmin: isOwner && role === 'Admin',
    makeOwner: isOwner && !client,
    remove: role === 'Member' ? isAdmin : isOwner,
  };
}

/** Aplica `participant_role_changed` a la fila (y a mi rol si soy yo). */
export function applyRoleChange(
  conv: ChatConversation,
  change: ConversationParticipantRoleChangedDto,
  currentUserId: string | null,
): ChatConversation {
  const participants = (conv.participants ?? []).map(p => (p.userId === change.userId ? { ...p, role: change.role } : p));
  const next = withParticipants(conv, participants, currentUserId);
  return change.userId === currentUserId ? { ...next, myRole: change.role } : next;
}

/** Quita a un miembro de la fila (salió o lo sacaron). */
export function removeParticipantFrom(conv: ChatConversation, userId: string, currentUserId: string | null): ChatConversation {
  return withParticipants(
    conv,
    (conv.participants ?? []).filter(p => p.userId !== userId),
    currentUserId,
  );
}

/** Aplica `chat.conversation.updated`: campo ausente = no cambió. */
export function applyConversationUpdate(conv: ChatConversation, update: ConversationUpdatedDto): ChatConversation {
  return {
    ...conv,
    ...(update.isArchived !== undefined ? { isArchived: update.isArchived } : {}),
    ...(update.title !== undefined && update.title !== null ? { name: update.title } : {}),
    ...(update.description !== undefined ? { description: update.description } : {}),
    ...(update.avatarFileId !== undefined ? { groupAvatarFileId: update.avatarFileId } : {}),
    ...(update.adminsOnlyWrite !== undefined ? { adminsOnlyWrite: update.adminsOnlyWrite } : {}),
    ...(update.isMuted !== undefined ? { isMuted: update.isMuted } : {}),
  };
}

/** Códigos del backend de grupos → copy en inglés para el usuario (sin filtrar detalles internos). */
export function groupErrorMessage(code: string): string {
  switch (code) {
    case 'Chat.GroupsDisabled':
      return 'Groups are turned off for your workspace.';
    case 'Chat.EmployeeToEmployeeDisabled':
      return 'Your office has turned off chats between employees.';
    case 'Directory.Unresolved':
      return "One of the people isn't ready to chat yet. Try again in a moment.";
    case 'Chat.Group.AdminOnly':
      return 'Only group admins can do this.';
    case 'Chat.Group.OwnerOnly':
      return 'Only the group owner can do this.';
    case 'Chat.Group.OwnerRole':
      return 'Make someone else the owner first.';
    case 'Chat.Member.ClientCannotBeAdmin':
      return "Clients can't be group admins.";
    case 'Chat.Member.SingleClientOnly':
      return 'Only one client can be in a group. An admin can allow more in Settings.';
    case 'Chat.Member.NotAssigned':
      return 'You can only add clients assigned to you.';
    case 'Chat.Member.NoPortalAccount':
      return "This client hasn't activated their portal yet.";
    case 'Chat.Member.Inactive':
      return 'This person is no longer active.';
    case 'Chat.Member.NotInTenant':
    case 'Chat.Member.NotAllowed':
      return "This person can't join office groups.";
    case 'Chat.Conversation.AlreadyParticipant':
      return 'This person is already in the group.';
    case 'Chat.Conversation.AdminsOnly':
      return 'Only admins can send messages in this group.';
    case 'Chat.Conversation.Archived':
      return 'This group is read-only.';
    case 'Chat.Conversation.NotParticipant':
      return "You're not a member of this group.";
    case 'Chat.Group.DescriptionTooLong':
      return 'The description is too long (500 characters max).';
    case 'Chat.Group.TitleTooLong':
    case 'Chat.Conversation.MissingTitle':
      return 'Enter a group name (120 characters max).';
    case 'Chat.Group.AvatarNotFound':
      return "We couldn't use that photo. Try another one.";
    case 'Socket.NotConnected':
    case 'Socket.Timeout':
      return "Couldn't reach the chat server. Please try again.";
    default:
      return 'Something went wrong. Please try again.';
  }
}
