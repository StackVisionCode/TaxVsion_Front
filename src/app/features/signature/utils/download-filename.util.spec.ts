import { buildSignatureDownloadFilename, sanitizeFileBase } from './download-filename.util';

describe('download-filename util', () => {
  it('arma el nombre del documento firmado y del certificado desde el título', () => {
    expect(buildSignatureDownloadFilename('2026 Individual Tax Return', 'signed')).toBe(
      '2026_Individual_Tax_Return_Signed.pdf',
    );
    expect(buildSignatureDownloadFilename('2026 Individual Tax Return', 'certificate')).toBe(
      '2026_Individual_Tax_Return_Certificate.pdf',
    );
    expect(buildSignatureDownloadFilename('Engagement letter', 'original')).toBe('Engagement_letter_Original.pdf');
  });

  it('quita acentos, reservados y separadores repetidos', () => {
    expect(sanitizeFileBase('  Declaración  2026 / Form 8879: "José" <draft>? ')).toBe(
      'Declaracion_2026_Form_8879_Jose_draft',
    );
  });

  it('no duplica la extensión si el título ya es un nombre de archivo', () => {
    expect(buildSignatureDownloadFilename('W-9 form.pdf', 'signed')).toBe('W_9_form_Signed.pdf');
  });

  it('usa un nombre genérico si el título está vacío o no deja caracteres útiles', () => {
    expect(buildSignatureDownloadFilename('', 'certificate')).toBe('Signature_Request_Certificate.pdf');
    expect(buildSignatureDownloadFilename(null, 'signed')).toBe('Signature_Request_Signed.pdf');
    expect(buildSignatureDownloadFilename('★★★', 'signed')).toBe('Signature_Request_Signed.pdf');
  });

  it('acota la longitud del título', () => {
    const name = buildSignatureDownloadFilename('A'.repeat(300), 'signed');
    expect(name).toBe(`${'A'.repeat(80)}_Signed.pdf`);
  });
});
