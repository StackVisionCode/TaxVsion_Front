import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SoundsService } from '@core/communication/media/sounds.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { CustomerDirectoryEntry } from './chat.model';
import { ChatStore } from './chat.store';
import { avatarColorFor } from '@shared/utils/avatar.util';

const customer = (displayName: string): CustomerDirectoryEntry => ({
  customerId: displayName,
  displayName,
  email: `${displayName}@example.com`,
  isActive: true,
  portalUserId: null,
});

describe('ChatStore — búsqueda de directorio', () => {
  let store: ChatStore;
  let responses: Record<string, Subject<CustomerDirectoryEntry[]>>;

  beforeEach(() => {
    responses = {};
    const directory = {
      searchCustomers: vi.fn((term: string) => (responses[term] = new Subject<CustomerDirectoryEntry[]>())),
      searchEmployees: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: directory },
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        { provide: ChatService, useValue: {} },
        { provide: ChatSocketService, useValue: {} },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: ToastService, useValue: {} },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('una respuesta vieja que llega tarde no pisa los resultados del texto actual', () => {
    store.searchCustomers('mina');
    store.searchCustomers('minat');

    responses['minat'].next([customer('Minato')]);
    responses['mina'].next([customer('Minaya'), customer('Minato')]);

    expect(store.customerResults().map(c => c.displayName)).toEqual(['Minato']);
    expect(store.employeeSearchLoading()).toBe(false);
  });

  it('borrar el texto cancela la búsqueda en vuelo', () => {
    store.searchCustomers('mina');
    store.searchCustomers('');

    responses['mina'].next([customer('Minato')]);

    expect(store.customerResults()).toEqual([]);
    expect(store.employeeSearchLoading()).toBe(false);
  });
});

describe('ChatStore — fotos de los participantes', () => {
  let store: ChatStore;
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) {
      streams.set(name, new Subject<unknown>());
    }
    return streams.get(name)!;
  };

  const summary = {
    id: 'c1',
    kind: 'Direct' as const,
    title: null,
    lastMessageAtUtc: null,
    updatedAtUtc: '2026-10-28T10:00:00Z',
    unreadCount: 0,
    participants: [
      { userId: 'me', displayName: 'Me', isPrimaryPreparer: false, avatarFileId: null },
      { userId: 'u-ana', displayName: 'Ana Pérez', isPrimaryPreparer: true, avatarFileId: 'f-ana' },
    ],
  };
  const group = {
    ...summary,
    id: 'g1',
    kind: 'Group' as const,
    title: 'Team',
    participants: [summary.participants[0], { userId: 'u-bob', displayName: 'Bob', isPrimaryPreparer: false }],
  };

  beforeEach(() => {
    streams.clear();
    const socket = new Proxy(
      {
        connected: signal(true),
        connect: vi.fn(),
        queryPresence: vi.fn(),
        markRead: vi.fn(() => Promise.resolve()),
        markDelivered: vi.fn(() => Promise.resolve()),
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : key.endsWith('$') ? stream(key) : undefined) },
    );
    const history = {
      items: [
        {
          id: 'm1',
          conversationId: 'g1',
          senderId: 'u-bob',
          senderDisplayName: 'Bob',
          senderAvatarFileId: 'f-bob',
          kind: 'Text',
          body: 'hey',
          attachmentFileId: null,
          replyToMessageId: null,
          forwardedFromMessageId: null,
          isEdited: false,
          isDeleted: false,
          isPinned: false,
          pinnedAtUtc: null,
          pinnedByUserId: null,
          createdAtUtc: '2026-10-28T10:00:00Z',
          editedAtUtc: null,
        },
      ],
      nextBeforeUtc: null,
      nextAfterUtc: null,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        {
          provide: ChatService,
          useValue: {
            listConversations: () => of({ items: [summary, group], page: 1, size: 50, totalCount: 2 }),
            getMessages: (id: string) => of(id === 'g1' ? history : { items: [], nextBeforeUtc: null, nextAfterUtc: null }),
          },
        },
        { provide: ChatSocketService, useValue: socket },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: ToastService, useValue: { error: vi.fn() } },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.load('c1');
  });

  afterEach(() => TestBed.resetTestingModule());

  const find = (id: string) => store.conversations().find(c => c.id === id)!;

  it('un 1:1 muestra la foto del par y su color sale de su userId', () => {
    expect(find('c1').avatarFileId).toBe('f-ana');
    expect(find('c1').avatarColor).toBe(avatarColorFor('u-ana'));
    expect(find('g1').avatarFileId).toBeNull();
  });

  it('user.profile.changed actualiza la foto en vivo (match por userId)', () => {
    stream('userProfileChanged$').next({ userId: 'u-ana', avatarFileId: 'f-ana-2' });
    expect(find('c1').avatarFileId).toBe('f-ana-2');

    stream('userProfileChanged$').next({ userId: 'u-ana', avatarFileId: null });
    expect(find('c1').avatarFileId).toBeNull();
  });

  it('el historial pone la foto del remitente y participant_added suma al miembro con la suya', () => {
    store.selectConversation('g1');
    const bob = find('g1').participants?.find(p => p.userId === 'u-bob');
    expect(bob?.avatarFileId).toBe('f-bob');
    const message = find('g1').messages[0];
    expect(message.senderUserId).toBe('u-bob');
    expect(message.senderAvatarFileId).toBe('f-bob');

    stream('participantAdded$').next({
      conversationId: 'g1',
      addedByUserId: 'me',
      newParticipantUserId: 'u-luis',
      newParticipantDisplayName: 'Luis',
      newParticipantAvatarFileId: 'f-luis',
      addedAtUtc: '2026-10-28T10:00:00Z',
    });
    expect(find('g1').participants?.find(p => p.userId === 'u-luis')?.avatarFileId).toBe('f-luis');
  });
});

describe('ChatStore — F7: transcripts de notas de voz y búsqueda', () => {
  let store: ChatStore;
  const streams = new Map<string, Subject<unknown>>();
  const stream = (name: string) => {
    if (!streams.has(name)) {
      streams.set(name, new Subject<unknown>());
    }
    return streams.get(name)!;
  };
  let searchMessages: ReturnType<typeof vi.fn>;
  let searchResponse: Subject<unknown>;
  let requestVoiceNoteTranscript: ReturnType<typeof vi.fn>;
  let transcriptResponse: Subject<unknown>;
  let toastError: ReturnType<typeof vi.fn>;

  const base = {
    conversationId: 'c1',
    senderDisplayName: 'Ana',
    replyToMessageId: null,
    forwardedFromMessageId: null,
    isEdited: false,
    isDeleted: false,
    isPinned: false,
    pinnedAtUtc: null,
    pinnedByUserId: null,
    editedAtUtc: null,
  };
  const history = {
    items: [
      // DESC (más nuevo primero), como el backend.
      { ...base, id: 's1', senderId: 'system', kind: 'System', body: 'Call transcript is ready', attachmentFileId: 'f-txt', createdAtUtc: '2026-10-30T10:02:00Z' },
      {
        ...base,
        id: 'v1',
        senderId: 'u-ana',
        kind: 'Attachment',
        body: null,
        attachmentFileId: 'f-voice',
        audioDurationMs: 4000,
        audioWaveform: [10, 20],
        transcriptState: 'Processing',
        transcriptText: null,
        createdAtUtc: '2026-10-30T10:01:00Z',
      },
    ],
    nextBeforeUtc: null,
    nextAfterUtc: null,
  };

  beforeEach(() => {
    streams.clear();
    searchResponse = new Subject<unknown>();
    searchMessages = vi.fn(() => searchResponse);
    transcriptResponse = new Subject<unknown>();
    requestVoiceNoteTranscript = vi.fn(() => transcriptResponse);
    toastError = vi.fn();
    const socket = new Proxy(
      {
        connected: signal(true),
        connect: vi.fn(),
        queryPresence: vi.fn(),
        markRead: vi.fn(() => Promise.resolve()),
        markDelivered: vi.fn(() => Promise.resolve()),
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : key.endsWith('$') ? stream(key) : undefined) },
    );
    const summary = {
      id: 'c1',
      kind: 'Direct' as const,
      title: null,
      lastMessageAtUtc: null,
      updatedAtUtc: '2026-10-30T10:00:00Z',
      unreadCount: 0,
      participants: [
        { userId: 'me', displayName: 'Me', isPrimaryPreparer: false },
        { userId: 'u-ana', displayName: 'Ana', isPrimaryPreparer: true },
      ],
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
        {
          provide: ChatService,
          useValue: {
            listConversations: () => of({ items: [summary], page: 1, size: 50, totalCount: 1 }),
            getMessages: () => of(history),
            searchMessages,
            requestVoiceNoteTranscript,
          },
        },
        { provide: ChatSocketService, useValue: socket },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: { getFile: () => new Subject() } },
        { provide: ToastService, useValue: { error: toastError } },
        { provide: SoundsService, useValue: { play: vi.fn() } },
      ],
    });
    store = TestBed.inject(ChatStore);
    store.load('c1');
  });

  afterEach(() => TestBed.resetTestingModule());

  const messages = () => store.conversations().find(c => c.id === 'c1')!.messages;

  it('mapea el estado del transcript de la nota de voz y el archivo del mensaje del sistema', () => {
    const voice = messages().find(m => m.id === 'v1')!;
    expect(voice.voiceNote).toEqual(expect.objectContaining({ fileId: 'f-voice', transcriptState: 'Processing', transcriptText: null }));
    expect(messages().find(m => m.id === 's1')!.systemAttachmentFileId).toBe('f-txt');
  });

  it('chat.message.transcript_updated parchea el mensaje cargado (y no toca otras conversaciones)', () => {
    stream('messageTranscriptUpdated$').next({ conversationId: 'c1', messageId: 'v1', transcriptState: 'Ready', transcriptText: 'Hola, te mando el W-2.' });
    expect(messages().find(m => m.id === 'v1')!.voiceNote).toEqual(
      expect.objectContaining({ transcriptState: 'Ready', transcriptText: 'Hola, te mando el W-2.' }),
    );

    stream('messageTranscriptUpdated$').next({ conversationId: 'otra', messageId: 'v1', transcriptState: 'Failed', transcriptText: null });
    expect(messages().find(m => m.id === 'v1')!.voiceNote?.transcriptState).toBe('Ready');
  });

  it('"Transcribe": marca Transcribing… al instante, pide al servidor y aplica la respuesta', () => {
    stream('messageTranscriptUpdated$').next({ conversationId: 'c1', messageId: 'v1', transcriptState: 'NotRequested', transcriptText: null });

    store.requestVoiceNoteTranscript('v1');

    expect(requestVoiceNoteTranscript).toHaveBeenCalledWith('c1', 'v1');
    expect(messages().find(m => m.id === 'v1')!.voiceNote?.transcriptState).toBe('Processing');
    transcriptResponse.next({ conversationId: 'c1', messageId: 'v1', transcriptState: 'Processing', transcriptText: null });
    expect(messages().find(m => m.id === 'v1')!.voiceNote?.transcriptState).toBe('Processing');
  });

  it('si el pedido falla, vuelve a "Transcribe" y avisa', () => {
    stream('messageTranscriptUpdated$').next({ conversationId: 'c1', messageId: 'v1', transcriptState: 'NotRequested', transcriptText: null });

    store.requestVoiceNoteTranscript('v1');
    transcriptResponse.error({ status: 409 });

    expect(messages().find(m => m.id === 'v1')!.voiceNote?.transcriptState).toBe('NotRequested');
    expect(toastError).toHaveBeenCalledWith("Couldn't start the transcription. Try again.");
  });

  it('busca en la conversación activa (texto y transcripts) y con menos de 2 caracteres limpia', () => {
    store.searchMessages('w');
    expect(searchMessages).not.toHaveBeenCalled();

    store.searchMessages('w-2');
    expect(searchMessages).toHaveBeenCalledWith('c1', 'w-2', 30);
    expect(store.searchLoading()).toBe(true);

    searchResponse.next({
      items: [{ ...history.items[1], transcriptState: 'Ready', transcriptText: 'te mando el W-2' }],
      limit: 30,
      truncated: false,
    });
    expect(store.searchLoading()).toBe(false);
    expect(store.searchResults()).toEqual([expect.objectContaining({ id: 'v1', senderName: 'Ana', text: 'te mando el W-2', isVoiceNote: true })]);

    store.searchMessages('');
    expect(store.searchResults()).toEqual([]);
  });

  it('un error de la búsqueda se muestra legible', () => {
    store.searchMessages('hola');
    searchResponse.error({ status: 400, error: { code: 'Chat.Search.QueryTooLong', message: 'Query must be at most 200 chars.' } });
    expect(store.searchError()).toBeTruthy();
    expect(store.searchResults()).toEqual([]);
  });
});
