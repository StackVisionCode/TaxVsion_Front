import { UploadPolicy } from './cloud-storage.model';
import { uploadRejection } from './storage-policy.service';

/** El front descarta antes de subir lo que la carpeta no admite, con el motivo; sin política no inventa nada. */
describe('uploadRejection', () => {
  const policy: UploadPolicy = {
    folderType: 'Tasks',
    maxFileSizeBytes: 1024,
    allowedExtensions: ['.pdf', '.png'],
    allowedContentTypes: ['application/pdf', 'image/png'],
    accept: '.pdf,.png',
  };

  it('accepts an allowed file within the size', () => {
    expect(uploadRejection(new File(['x'], 'w2.PDF'), policy)).toBeNull();
  });

  it('rejects a type the folder does not take', () => {
    expect(uploadRejection(new File(['x'], 'setup.exe'), policy)).toContain("isn't an accepted file type");
  });

  it('rejects a file over the size', () => {
    expect(uploadRejection(new File([new Uint8Array(2048)], 'big.pdf'), policy)).toContain('is larger than');
  });

  it('lets everything through while the policy is unknown', () => {
    expect(uploadRejection(new File(['x'], 'setup.exe'), null)).toBeNull();
  });
});
