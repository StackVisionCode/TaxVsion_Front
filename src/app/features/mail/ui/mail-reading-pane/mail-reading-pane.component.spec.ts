import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MailReadingPaneComponent } from './mail-reading-pane.component';
import { DeliveryNoticeSummary, MessageSummary, ThreadSummary } from '../../data-access/mail.model';

const thread: ThreadSummary = {
  threadId: 't1',
  subject: 'Your W-2',
  status: 'Active',
  messageCount: 2,
  firstMessageAtUtc: '2026-11-02T09:00:00Z',
  lastMessageAtUtc: '2026-11-02T10:00:00Z',
  unreadCount: 1,
  customerId: null,
};

const notice = (over: Partial<DeliveryNoticeSummary> = {}): DeliveryNoticeSummary => ({
  deliveryNoticeId: 'n1',
  draftId: 'd1',
  recipient: 'maria@x.con',
  outcome: 'NotDelivered',
  category: 'InvalidAddress',
  reasonCode: 'invalid_address',
  statusCode: '5.1.1',
  diagnostic: '550 user unknown',
  suppressed: true,
  canViewOriginal: true,
  isRead: false,
  occurredAtUtc: '2026-11-02T10:00:00Z',
  receivedAtUtc: '2026-11-02T10:00:00Z',
  ...over,
});

const sent: MessageSummary = {
  messageId: 'd1',
  direction: 'Outbound',
  from: null,
  fromDisplayName: null,
  subject: 'Your W-2',
  snippet: null,
  toAddresses: ['maria@x.con', 'juan@x.com'],
  occurredAtUtc: '2026-11-02T09:00:00Z',
  hasAttachments: false,
  attachmentCount: 0,
  bodyStatus: null,
  isRead: true,
  senderTrust: null,
  kind: 'Email',
  deliveryStatus: 'NotDelivered',
  deliveries: [
    {
      address: 'maria@x.con',
      type: 'To',
      status: 'NotDelivered',
      category: 'InvalidAddress',
      updatedAtUtc: null,
    },
    { address: 'juan@x.com', type: 'To', status: 'Delivered', category: null, updatedAtUtc: null },
  ],
};

const noticeMessage = (over: Partial<DeliveryNoticeSummary> = {}): MessageSummary => ({
  ...sent,
  messageId: 'n1',
  direction: 'Inbound',
  toAddresses: ['maria@x.con'],
  kind: 'DeliveryNotice',
  deliveryStatus: null,
  deliveries: null,
  deliveryNotice: notice(over),
});

// R3: la tarjeta de aviso (qué falló, a quién, qué hacer) y la píldora de entrega del enviado.
describe('MailReadingPaneComponent · avisos de entrega', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MailReadingPaneComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render(messages: MessageSummary[], inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(MailReadingPaneComponent);
    fixture.componentRef.setInput('thread', thread);
    fixture.componentRef.setInput('messages', messages);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const buttons = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[role="note"] button')).map((button) =>
      button.textContent?.trim(),
    );

  it('pinta el aviso como tarjeta: titular claro, destinatario, qué hacer y bloqueo', () => {
    const fixture = render([sent, noticeMessage()], { canResend: true, canUnblock: true });
    const card = fixture.nativeElement.querySelector('[role="note"]') as HTMLElement;
    expect(card.textContent).toContain("Not delivered — the address doesn't exist");
    expect(card.textContent).toContain('maria@x.con');
    expect(card.textContent).toContain('Check the address for typos');
    expect(card.textContent).toContain('Future emails to this address are blocked.');
    expect(buttons(fixture.nativeElement)).toEqual([
      'Fix address and resend',
      'View original notice',
      'Unblock',
    ]);
    // La tarjeta no se puede mandar a la papelera como un correo.
    expect(card.querySelector('[aria-label="Move to Trash"]')).toBeNull();
  });

  it('sin permiso no hay Unblock; sin buzón no hay reenvío; un Delayed solo informa', () => {
    expect(
      buttons(render([noticeMessage()], { canResend: false, canUnblock: false }).nativeElement),
    ).toEqual(['View original notice']);
    expect(
      buttons(
        render(
          [
            noticeMessage({
              outcome: 'Delayed',
              reasonCode: 'delayed',
              suppressed: false,
              canViewOriginal: false,
            }),
          ],
          {
            canResend: true,
            canUnblock: true,
          },
        ).nativeElement,
      ),
    ).toEqual([]);
  });

  it('buzón lleno ofrece Resend; rechazado pone primero el aviso original', () => {
    expect(
      buttons(
        render([noticeMessage({ reasonCode: 'mailbox_full', suppressed: false })], {
          canResend: true,
        }).nativeElement,
      ),
    ).toEqual(['Resend', 'View original notice']);
    expect(
      buttons(
        render([noticeMessage({ reasonCode: 'rejected', suppressed: false })], { canResend: true })
          .nativeElement,
      ),
    ).toEqual(['View original notice', 'Resend']);
  });

  it('las acciones avisan al padre con el aviso (Fix resalta el destinatario)', () => {
    const fixture = render([noticeMessage()], { canResend: true, canUnblock: true });
    const component = fixture.componentInstance;
    const resend: Array<{ fix: boolean }> = [];
    const views: string[] = [];
    const unblocks: string[] = [];
    component.noticeResendRequested.subscribe((event) => resend.push({ fix: event.fix }));
    component.noticeOriginalRequested.subscribe((item) => views.push(item.deliveryNoticeId));
    component.noticeUnblockRequested.subscribe((item) => unblocks.push(item.recipient));

    (
      Array.from(
        fixture.nativeElement.querySelectorAll('[role="note"] button'),
      ) as HTMLButtonElement[]
    ).forEach((button) => button.click());

    expect(resend).toEqual([{ fix: true }]);
    expect(views).toEqual(['n1']);
    expect(unblocks).toEqual(['maria@x.con']);
  });

  it('el enviado muestra "Not delivered" en vez del "Sent" fijo, con el detalle por destinatario', () => {
    const fixture = render([sent]);
    const pill = fixture.nativeElement.querySelector('app-status-pill') as HTMLElement;
    expect(pill.textContent?.trim()).toBe('Not delivered');
    expect(pill.getAttribute('title')).toBe('maria@x.con: Not delivered\njuan@x.com: Delivered');

    fixture.componentRef.setInput('expandedId', 'd1');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Delivery');
    expect(text).toContain('juan@x.com');
  });

  it('sin noticias el enviado sigue diciendo "Sent"', () => {
    const fixture = render([{ ...sent, deliveryStatus: null, deliveries: [] }]);
    expect(
      (fixture.nativeElement.querySelector('app-status-pill') as HTMLElement).textContent?.trim(),
    ).toBe('Sent');
  });

  it('el enviado muestra To, Cc y Bcc; sin copias solo el To', () => {
    const fixture = render([
      { ...sent, deliveries: [], deliveryStatus: null, ccAddresses: ['ana@x.com'], bccAddresses: ['jefe@x.com'] },
    ]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('To maria@x.con, juan@x.com · Cc ana@x.com · Bcc jefe@x.com');

    const plain = render([{ ...sent, deliveries: [], deliveryStatus: null }]);
    const plainText = (plain.nativeElement as HTMLElement).textContent ?? '';
    expect(plainText).toContain('To maria@x.con, juan@x.com');
    expect(plainText).not.toContain('Cc ');
  });
});
