import { attachmentStatusHint, attachmentStatusLabel } from '../../features/clients/utils/client-notes-view';
import { documentStatusLabel } from '../../features/clients/data-access/client-requests.model';
import { FILE_BLOCKED_BY_POLICY_TEXT, FILE_UNDER_REVIEW_HINT, isBlockedByPolicy, rejectedFileText } from './file-moderation';

// T-20: cada módulo distingue "en revisión" y "bloqueado por política" sin mostrar el código técnico.
describe('file moderation copy', () => {
  it('reconoce el bloqueo por política con las dos grafías de los servicios', () => {
    expect(isBlockedByPolicy('blocked-by-policy')).toBe(true);
    expect(isBlockedByPolicy('blocked_by_policy')).toBe(true);
    expect(isBlockedByPolicy('infected')).toBe(false);
    expect(rejectedFileText('blocked-by-policy')).toBe(FILE_BLOCKED_BY_POLICY_TEXT);
    expect(rejectedFileText('infected')).toBe('Blocked by the security scan');
  });

  it('notas: etiqueta y tooltip de revisión y de bloqueo', () => {
    expect(attachmentStatusLabel('UnderReview')).toBe('Under review');
    expect(attachmentStatusHint('UnderReview', null)).toBe(FILE_UNDER_REVIEW_HINT);
    expect(attachmentStatusHint('Rejected', 'blocked-by-policy')).toBe(FILE_BLOCKED_BY_POLICY_TEXT);
  });

  it('pedidos: el documento muestra su estado solo cuando todavía no sirve', () => {
    expect(documentStatusLabel('UnderReview')).toBe('Under review');
    expect(documentStatusLabel('Pending')).toBe('Scanning…');
    expect(documentStatusLabel('Available')).toBeNull();
  });
});
