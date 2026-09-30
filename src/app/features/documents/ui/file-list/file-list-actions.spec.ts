import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { FileResponse, FolderResponse } from '../../data-access/documents.model';
import { FileListComponent } from './file-list.component';

/**
 * B6 — las acciones de fila de Documents. La §34 marcaba la fila entera como "nada gateado", y son
 * acciones destructivas: borrar un archivo, borrar una carpeta con todo dentro, revocar un enlace.
 * Se renderiza de verdad porque lo que importa es qué BOTONES aparecen, no qué contesta un signal.
 */
describe('FileListComponent · acciones de fila', () => {
  const FILE = {
    id: 'file-1',
    originalName: 'return.pdf',
    status: 'Available',
    sizeBytes: 1024,
    folderId: null,
  } as unknown as FileResponse;

  const FOLDER = { id: 'folder-1', name: 'Tax 2025' } as unknown as FolderResponse;

  function render(permissions: readonly string[]) {
    // Cada render arma su propio módulo: dos en el mismo test necesitan reiniciarlo.
    TestBed.resetTestingModule();
    const granted = new Set(permissions);
    TestBed.configureTestingModule({
      imports: [FileListComponent],
      providers: [
        {
          provide: AccessStore,
          useValue: {
            can: (code: string) => granted.has(code),
            canAny: (codes: readonly string[]) => codes.some(c => granted.has(c)),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(FileListComponent);
    fixture.componentInstance.files = [FILE];
    fixture.componentInstance.subfolders = [FOLDER];
    fixture.detectChanges();
    return fixture;
  }

  function titles(fixture: ReturnType<typeof render>): string[] {
    const buttons = fixture.nativeElement.querySelectorAll('button[title]') as NodeListOf<HTMLElement>;
    return [...buttons].map(button => button.getAttribute('title') ?? '');
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sin permisos de escritura no se ofrece ninguna acción destructiva', () => {
    const offered = titles(render(['cloudstorage.file.view']));

    expect(offered).not.toContain('Delete');
    expect(offered).not.toContain('Move');
    expect(offered).not.toContain('Share');
    expect(offered).not.toContain('Rename');
  });

  it('borrar una carpeta depende de folder.manage, no de file.delete', () => {
    // Son permisos distintos en el backend y borrar una carpeta se lleva todo lo que hay dentro.
    const soloArchivos = render(['cloudstorage.file.view', 'cloudstorage.file.delete']);
    const botones = soloArchivos.nativeElement.querySelectorAll('button[aria-label]') as NodeListOf<HTMLElement>;
    const labels = [...botones].map(b => b.getAttribute('aria-label') ?? '');

    expect(labels).toContain('Delete file');
    expect(labels).not.toContain('Delete folder');
  });

  it('descargar pide file.download, no file.view', () => {
    const soloVer = titles(render(['cloudstorage.file.view']));
    expect(soloVer).not.toContain('Download');

    const conDescarga = titles(render(['cloudstorage.file.view', 'cloudstorage.file.download']));
    expect(conDescarga).toContain('Download');
  });

  it('con todo, aparecen las acciones completas', () => {
    const offered = titles(
      render([
        'cloudstorage.file.view',
        'cloudstorage.file.download',
        'cloudstorage.file.delete',
        'cloudstorage.folder.manage',
        'cloudstorage.share.create',
      ]),
    );

    expect(offered).toContain('Delete');
    expect(offered).toContain('Move');
    expect(offered).toContain('Share');
    expect(offered).toContain('Rename');
  });
});
