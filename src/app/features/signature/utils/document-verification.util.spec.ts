import { describe, expect, it } from 'vitest';
import { documentVerificationLabel, rejectedDocumentMessage, VerifiableDocument } from './document-verification.util';

const doc = (overrides: Partial<VerifiableDocument> = {}): VerifiableDocument => ({
  title: 'Engagement letter',
  hashPre: null,
  hashPost: null,
  ...overrides,
});

describe('document-verification.util', () => {
  it('muestra el motivo cuando el servidor rechazó el archivo', () => {
    const rejected = doc({ verificationStatus: 'Rejected', rejectionReason: 'PDF already contains signatures.' });

    expect(documentVerificationLabel(rejected)).toBe('Rejected: PDF already contains signatures. Replace the file.');
  });

  it('distingue verificado, pendiente y sellado', () => {
    expect(documentVerificationLabel(doc({ hashPre: 'a'.repeat(64), verificationStatus: 'Verified' }))).toBe(
      'Original verified',
    );
    expect(documentVerificationLabel(doc({ verificationStatus: 'Pending' }))).toBe('Verification pending');
    expect(documentVerificationLabel(doc({ hashPre: 'a', hashPost: 'b' }))).toBe('Sealed and verified');
  });

  it('el mensaje de envío nombra el primer documento rechazado', () => {
    const message = rejectedDocumentMessage([
      doc({ title: 'W-2', verificationStatus: 'Verified', hashPre: 'a' }),
      doc({ title: 'Form 8879', verificationStatus: 'Rejected', rejectionReason: 'PDF cannot exceed 100 pages.' }),
    ]);

    expect(message).toBe('"Form 8879" can\'t be sent: PDF cannot exceed 100 pages. Replace the file and try again.');
  });

  it('sin rechazos no hay mensaje (pendiente sigue esperando el scan)', () => {
    expect(rejectedDocumentMessage([doc({ verificationStatus: 'Pending' })])).toBeNull();
  });
});
