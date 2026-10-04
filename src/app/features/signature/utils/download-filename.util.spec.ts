import { buildSignatureDownloadFilename, sanitizeFileBase } from './download-filename.util';

describe('download-filename.util', () => {
  it('arma el nombre a partir del título con sufijo por tipo', () => {
    expect(buildSignatureDownloadFilename('2026 Individual Tax Return', 'signed')).toBe('2026_Individual_Tax_Return_Signed.pdf');
    expect(buildSignatureDownloadFilename('2026 Individual Tax Return', 'certificate')).toBe(
      '2026_Individual_Tax_Return_Certificate.pdf',
    );
    expect(buildSignatureDownloadFilename('Engagement letter.pdf', 'original')).toBe('Engagement_letter_Original.pdf');
  });

  it('quita acentos y caracteres reservados', () => {
    expect(sanitizeFileBase('Declaración / José: 2025?')).toBe('Declaracion_Jose_2025');
  });

  it('usa un nombre genérico si el título queda vacío y acota la longitud', () => {
    expect(sanitizeFileBase('  ***  ')).toBe('Signature_Request');
    expect(sanitizeFileBase(null)).toBe('Signature_Request');
    expect(sanitizeFileBase('a'.repeat(200)).length).toBe(80);
  });
});
