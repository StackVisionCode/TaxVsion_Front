import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { VoiceNoteRecorderService } from '@core/communication/voice-note-recorder.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ChatStore } from '../../data-access/chat.store';
import type { ChatConversation } from '../../ui/chat-conversation-list/chat-conversation-list.component';
import { ChatConversationPanelComponent } from './conversation-panel.component';

const conversation = (overrides: Partial<ChatConversation> = {}): ChatConversation => ({
  id: 'c1',
  name: 'Billing question',
  kind: 'Support',
  peerUserId: null,
  avatarColor: 'bg-brand-bold',
  presence: 'Offline',
  busyReason: null,
  typingName: null,
  recordingName: null,
  hasMoreHistory: false,
  unread: 0,
  messages: [],
  ...overrides,
});

function render(conv: ChatConversation, closedLabel?: string) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ChatStore, useValue: { loadingOlder: signal(false), uploadingAttachment: signal(false), sendMessage: vi.fn() } },
      { provide: ToastService, useValue: { error: vi.fn() } },
      { provide: CloudStorageUploadService, useValue: { getFile: vi.fn() } },
      { provide: VoiceNoteRecorderService, useValue: { isRecording: signal(false), isSupported: true, level: signal(0), elapsedMs: signal(0) } },
    ],
  });
  const fixture = TestBed.createComponent(ChatConversationPanelComponent);
  fixture.componentRef.setInput('conversation', conv);
  if (closedLabel) fixture.componentRef.setInput('closedLabel', closedLabel);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChatConversationPanelComponent (T-11, F8a)', () => {
  it('con el chat activo muestra el composer', () => {
    const el = render(conversation());
    expect(el.querySelector('app-chat-composer')).not.toBeNull();
    expect(el.querySelector('[data-role="conversation-closed"]')).toBeNull();
  });

  it('archivado (ticket cerrado) queda en solo lectura con su texto', () => {
    const el = render(conversation({ isArchived: true }), 'This ticket is closed. Reopen it to keep chatting.');
    expect(el.querySelector('app-chat-composer')).toBeNull();
    expect(el.querySelector('[data-role="conversation-closed"]')?.textContent).toContain('This ticket is closed.');
  });

  it('F8b (D-23): en modo anuncio un Member no tiene composer; un Admin sí', () => {
    const member = render(conversation({ kind: 'Group', adminsOnlyWrite: true, myRole: 'Member' }));
    expect(member.querySelector('app-chat-composer')).toBeNull();
    expect(member.querySelector('[data-role="admins-only"]')?.textContent).toContain('Only admins can send messages');
    TestBed.resetTestingModule();
    const admin = render(conversation({ kind: 'Group', adminsOnlyWrite: true, myRole: 'Admin' }));
    expect(admin.querySelector('app-chat-composer')).not.toBeNull();
  });
});
