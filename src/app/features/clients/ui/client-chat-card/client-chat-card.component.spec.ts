import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ClientChatService } from '../../data-access/client-chat.service';
import { ClosedChatMessage } from '../../data-access/client-chat.model';
import { ClientChatCardComponent } from './client-chat-card.component';

const message = (id: string, body: string, createdAtUtc: string, kind: ClosedChatMessage['kind'] = 'Text'): ClosedChatMessage => ({
  id,
  senderId: 's',
  senderDisplayName: 'Ana Pérez',
  kind,
  body,
  createdAtUtc,
});

describe('ClientChatCardComponent — previous conversations', () => {
  const chat = {
    searchCustomers: vi.fn(() => of([{ customerId: 'c1', displayName: 'Client', email: 'c@x.com', isActive: true, portalUserId: 'p1' }])),
    listClosedChats: vi.fn(() =>
      of({
        items: [
          {
            conversationId: 'conv1',
            formerStaffUserId: 'u-old',
            formerStaffDisplayName: 'Ana Pérez',
            closedAtUtc: '2026-11-03T12:00:00Z',
            lastMessageAtUtc: '2026-11-02T12:00:00Z',
          },
        ],
      }),
    ),
    getMessages: vi.fn(),
  };

  function render() {
    TestBed.configureTestingModule({
      imports: [ClientChatCardComponent],
      providers: [provideRouter([]), { provide: ClientChatService, useValue: chat }],
    });
    const fixture = TestBed.createComponent(ClientChatCardComponent);
    fixture.componentRef.setInput('customerId', 'c1');
    fixture.componentRef.setInput('email', 'c@x.com');
    fixture.detectChanges();
    return fixture;
  }

  const q = (selector: string) => document.body.querySelector(selector);

  beforeEach(() => {
    chat.getMessages.mockReset();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lista los chats cerrados y abre el historial de lo más viejo a lo más nuevo', () => {
    // El backend devuelve de lo más nuevo a lo más viejo.
    chat.getMessages.mockReturnValueOnce(
      of({
        items: [message('m2', 'Second', '2026-11-02T10:00:00Z'), message('m1', 'First', '2026-11-01T10:00:00Z')],
        nextBeforeUtc: '2026-11-01T10:00:00Z',
      }),
    );
    const fixture = render();

    expect(q('[data-testid="closed-chats"]')?.textContent).toContain('Ana Pérez');
    (q('[data-closed-chat="conv1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.detectChanges();

    const text = q('[data-testid="closed-chat-messages"]')!.textContent!;
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'));
    expect(chat.getMessages).toHaveBeenCalledWith('conv1', null);

    // "Load earlier" pide la página anterior con el cursor.
    chat.getMessages.mockReturnValueOnce(of({ items: [message('m0', 'Zero', '2026-10-31T10:00:00Z')], nextBeforeUtc: null }));
    fixture.componentInstance.loadMessages();
    fixture.detectChanges();
    expect(chat.getMessages).toHaveBeenLastCalledWith('conv1', '2026-11-01T10:00:00Z');
    expect(fixture.componentInstance.messages()[0].body).toBe('Zero');
    expect(fixture.componentInstance.hasEarlier()).toBe(false);
  });

  it('sin chats cerrados (o sin permiso) no muestra la sección', () => {
    chat.listClosedChats.mockReturnValueOnce(throwError(() => new Error('403')));
    render();

    expect(q('[data-testid="closed-chats"]')).toBeNull();
  });
});
