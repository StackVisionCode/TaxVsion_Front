import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../../data-access/chat.service';
import { ChatSocketService } from '../../data-access/chat-socket.service';
import { ConversationContentTabsComponent } from './conversation-content-tabs.component';

/** F8d — pestañas de Info: Media al abrir, cambio a Links, "Load more" y retiro en vivo de lo rechazado. */
describe('ConversationContentTabsComponent', () => {
  function render() {
    const flagged$ = new Subject<unknown>();
    const getConversationContent = vi.fn((_: string, tab: string, before?: string | null) => {
      if (tab === 'Links') {
        return of({ items: [{ kind: 'Link', id: 'l1', messageId: 'm', senderId: 'a', url: 'https://irs.gov/', domain: 'irs.gov', createdAtUtc: '' }], nextBefore: null });
      }
      return of(
        before
          ? { items: [{ kind: 'Attachment', fileId: 'f3', messageId: 'm3', senderId: 'a', category: 'Image', contentType: 'image/png', fileName: 'c.png', sizeBytes: 1, status: 'Available', createdAtUtc: '' }], nextBefore: null }
          : {
              items: [
                { kind: 'Attachment', fileId: 'f1', messageId: 'm1', senderId: 'a', category: 'Image', contentType: 'image/png', fileName: 'a.png', sizeBytes: 1, status: 'Available', createdAtUtc: '' },
                { kind: 'Attachment', fileId: 'f2', messageId: 'm2', senderId: 'a', category: 'Video', contentType: 'video/mp4', fileName: 'b.mp4', sizeBytes: 1, status: 'Pending', createdAtUtc: '' },
              ],
              nextBefore: 'cursor-1',
            },
      );
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatService, useValue: { getConversationContent } },
        { provide: ChatSocketService, useValue: { attachmentFlagged$: flagged$ } },
      ],
    });
    const fixture = TestBed.createComponent(ConversationContentTabsComponent);
    fixture.componentRef.setInput('conversationId', 'c1');
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, getConversationContent, flagged$ };
  }

  it('abre en Media; lo que escanea no se abre; "Load more" pide con el cursor', () => {
    const { fixture, el, getConversationContent } = render();
    expect(getConversationContent).toHaveBeenCalledWith('c1', 'Media', null);
    const files = el.querySelectorAll<HTMLButtonElement>('[data-role="content-file"]');
    expect(files).toHaveLength(2);
    expect(files[1].disabled).toBe(true);
    expect(files[1].textContent).toContain('Scanning…');

    el.querySelector<HTMLButtonElement>('[data-role="content-load-more"]')?.click();
    fixture.detectChanges();
    expect(getConversationContent).toHaveBeenLastCalledWith('c1', 'Media', 'cursor-1');
    expect(el.querySelectorAll('[data-role="content-file"]')).toHaveLength(3);
  });

  it('Links abre en otra pestaña con rel seguro; un rechazo del escaneo quita el archivo en vivo', () => {
    const { fixture, el, flagged$ } = render();
    flagged$.next({ conversationId: 'c1', messageId: 'm1', fileId: 'f1', status: 'Infected' });
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-role="content-file"]')).toHaveLength(1);

    fixture.componentInstance.selectTab('Links');
    fixture.detectChanges();
    const link = el.querySelector<HTMLAnchorElement>('[data-role="content-link"]');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });
});
