import { describe, expect, it } from 'vitest';
import {
  DeliveryNoticeSummary,
  deliveryDetail,
  deliveryNoticeCopy,
  deliveryStatusPill,
  isCurrentDeliveryNotice,
} from './mail.model';

const notice = (over: Partial<DeliveryNoticeSummary> = {}): DeliveryNoticeSummary => ({
  deliveryNoticeId: 'n1',
  draftId: 'd1',
  recipient: 'maria@x.com',
  outcome: 'NotDelivered',
  category: 'InvalidAddress',
  reasonCode: 'invalid_address',
  statusCode: '5.1.1',
  diagnostic: '550 5.1.1 user unknown',
  suppressed: true,
  canViewOriginal: true,
  isRead: false,
  occurredAtUtc: '2026-11-02T10:00:00',
  receivedAtUtc: '2026-11-02T10:00:05',
  ...over,
});

describe('Avisos y estado de entrega: textos claros', () => {
  it('cada motivo tiene titular, motivo, qué hacer, acción principal y chip', () => {
    expect(deliveryNoticeCopy(notice())).toMatchObject({
      title: "Not delivered — the address doesn't exist",
      primary: 'fix',
      chip: 'Not delivered',
      tone: 'red',
    });
    expect(deliveryNoticeCopy(notice({ reasonCode: 'domain_not_found' })).reason).toBe(
      "The domain @x.com doesn't exist. Check for typos.",
    );
    expect(deliveryNoticeCopy(notice({ reasonCode: 'mailbox_full' }))).toMatchObject({
      title: 'Mailbox full — try again later',
      primary: 'resend',
      chip: 'Mailbox full',
      tone: 'amber',
    });
    expect(deliveryNoticeCopy(notice({ reasonCode: 'rejected' })).primary).toBe('view');
    expect(deliveryNoticeCopy(notice({ reasonCode: 'too_large' })).primary).toBe('edit');
    expect(deliveryNoticeCopy(notice({ reasonCode: 'something_new' })).title).toBe('Not delivered');
  });

  it('un Delayed es informativo, gris, sin acción', () => {
    expect(deliveryNoticeCopy(notice({ outcome: 'Delayed', reasonCode: 'delayed' }))).toMatchObject(
      {
        title: 'Delayed — still trying',
        primary: 'none',
        chip: 'Delayed',
        tone: 'gray',
      },
    );
  });

  it('la píldora del enviado sale del peor estado; sin noticias sigue diciendo "Sent"', () => {
    expect(deliveryStatusPill('Delivered')).toEqual({ label: 'Delivered', tone: 'green' });
    expect(deliveryStatusPill('NotDelivered')).toEqual({ label: 'Not delivered', tone: 'red' });
    expect(deliveryStatusPill('Delayed')).toEqual({ label: 'Delayed', tone: 'amber' });
    expect(deliveryStatusPill(null)).toEqual({ label: 'Sent', tone: 'gray' });
    expect(
      deliveryDetail([
        { address: 'a@x.com', type: 'To', status: 'Delivered', category: null, updatedAtUtc: null },
        { address: 'b@x.com', type: 'Cc', status: null, category: null, updatedAtUtc: null },
      ]),
    ).toBe('a@x.com: Delivered\nb@x.com: Sent');
  });

  it('la fila solo muestra el aviso mientras sea lo último del hilo', () => {
    expect(
      isCurrentDeliveryNotice({
        lastMessageAtUtc: '2026-11-02T10:00:05',
        latestDeliveryNotice: notice(),
      }),
    ).toBe(true);
    // Un Delayed no sube el hilo: su hora es posterior al último enviado.
    expect(
      isCurrentDeliveryNotice({
        lastMessageAtUtc: '2026-11-02T09:00:00',
        latestDeliveryNotice: notice(),
      }),
    ).toBe(true);
    // El cliente respondió después del rebote: ya no se marca.
    expect(
      isCurrentDeliveryNotice({
        lastMessageAtUtc: '2026-11-03T08:00:00',
        latestDeliveryNotice: notice(),
      }),
    ).toBe(false);
    expect(
      isCurrentDeliveryNotice({
        lastMessageAtUtc: '2026-11-02T10:00:00',
        latestDeliveryNotice: null,
      }),
    ).toBe(false);
  });
});
