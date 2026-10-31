import { ATTACHMENT_STATE_LABELS, toAttachmentScanState } from './chat-message.model';

// T-20: el estado del backend se traduce a lo que ve el usuario; nunca se muestra un motivo interno.
describe('toAttachmentScanState', () => {
  it('distingue en revisión y bloqueado del resto de rechazos', () => {
    expect(toAttachmentScanState('Pending')).toBe('Pending');
    expect(toAttachmentScanState('Available')).toBe('Available');
    expect(toAttachmentScanState('PendingReview')).toBe('UnderReview');
    expect(toAttachmentScanState('BlockedByPolicy')).toBe('Blocked');
    expect(toAttachmentScanState('Infected')).toBe('Unavailable');
    expect(toAttachmentScanState('Deleted')).toBe('Unavailable');
    expect(toAttachmentScanState(undefined)).toBe('Unavailable');
  });

  it('el bloqueo explica la política de contenido', () => {
    expect(ATTACHMENT_STATE_LABELS.Blocked).toBe('Blocked: this file goes against our content policy');
    expect(ATTACHMENT_STATE_LABELS.UnderReview).toBe('Under review');
  });
});
