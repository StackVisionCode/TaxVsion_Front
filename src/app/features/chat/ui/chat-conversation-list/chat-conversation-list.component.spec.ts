import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatConversationListComponent, type ChatConversation } from './chat-conversation-list.component';

/** Rail de conversaciones: la foto de cada fila. */
describe('ChatConversationListComponent', () => {
  const conversation = (over: Partial<ChatConversation>): ChatConversation => ({
    id: 'c1',
    name: 'Tax team',
    kind: 'Direct',
    peerUserId: null,
    avatarColor: 'bg-x',
    participants: [],
    presence: 'Offline',
    busyReason: null,
    typingName: null,
    recordingName: null,
    hasMoreHistory: false,
    unread: 0,
    messages: [],
    ...over,
  });

  function avatarSources(conversations: ChatConversation[]): string[] {
    const fixture = TestBed.createComponent(ChatConversationListComponent);
    fixture.componentInstance.conversations = conversations;
    fixture.detectChanges();
    return Array.from(fixture.nativeElement.querySelectorAll('img') as NodeListOf<HTMLImageElement>).map(img => img.src);
  }

  it('un grupo muestra su propia foto y no la del otro participante', () => {
    const sources = avatarSources([
      conversation({ id: 'g1', kind: 'Group', avatarFileId: 'member-photo', groupAvatarFileId: 'group-photo' }),
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain('group-photo');
  });

  it('un chat directo sigue mostrando la foto del otro participante', () => {
    const sources = avatarSources([conversation({ id: 'd1', kind: 'Direct', avatarFileId: 'peer-photo', groupAvatarFileId: null })]);

    expect(sources[0]).toContain('peer-photo');
  });
});
