import { nextSeqAfter } from './editor-id-seq.util';

describe('nextSeqAfter', () => {
  it('sin ids previos arranca en 0', () => {
    expect(nextSeqAfter([])).toBe(0);
  });

  it('sigue por encima del mayor sufijo de signer-/field-/prep- (snapshot restaurado)', () => {
    const ids = [
      'client:42',
      'signer-2',
      'field-0',
      'field-7',
      'prep-3',
      'seed-abc',
      'seed-prep-x',
    ];
    expect(nextSeqAfter(ids)).toBe(8);
  });

  it('ignora sufijos no numéricos y otros prefijos', () => {
    expect(nextSeqAfter(['field-x', 'fields-9', 'seed-field-12', 'signer-'])).toBe(0);
  });

  it('acepta prefijos propios (p. ej. el editor de plantillas)', () => {
    expect(nextSeqAfter(['role-4', 'tf-10'], ['role', 'tf'])).toBe(11);
  });
});
