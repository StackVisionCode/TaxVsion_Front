import { TestBed } from '@angular/core/testing';
import { FileResponse } from '../../data-access/documents.model';
import { ShareDialogComponent } from './share-dialog.component';

/**
 * B5 — el estado de "Public links" del diálogo de compartir.
 *
 * El ajuste se lee de `GET /storage/usage`, que exige `cloudstorage.settings.manage`. Un empleado
 * recibe 403, `usage()` queda en null y con el booleano de antes eso se convertía en "Disabled —
 * turned off by your firm": la pantalla afirmaba algo que la aplicación nunca pudo comprobar, y
 * que además suele ser falso. Tres estados, no dos.
 */
describe('ShareDialogComponent · public links', () => {
  function create(publicSharing: 'enabled' | 'disabled' | 'unknown') {
    TestBed.configureTestingModule({ imports: [ShareDialogComponent] });
    const fixture = TestBed.createComponent(ShareDialogComponent);
    // El diálogo se pinta cuando tiene un archivo; basta con el mínimo para renderizar.
    fixture.componentInstance.file = { id: 'file-1', name: 'return.pdf' } as unknown as FileResponse;
    fixture.componentInstance.publicSharing = publicSharing;
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('habilitado: lo dice y ofrece la opción', () => {
    const fixture = create('enabled');
    const text = document.body.textContent as string;

    expect(text).toContain('Enabled');
    expect(fixture.componentInstance.accessOptions.some(o => o.id === 'Public')).toBe(true);
  });

  it('deshabilitado: lo dice y explica por qué', () => {
    const fixture = create('disabled');
    const text = document.body.textContent as string;

    expect(text).toContain('Turned off by your firm');
    expect(fixture.componentInstance.accessOptions.some(o => o.id === 'Public')).toBe(false);
  });

  it('desconocido: NO afirma que la oficina lo apagó', () => {
    const fixture = create('unknown');
    const text = document.body.textContent as string;

    expect(text).not.toContain('Turned off by your firm');
    expect(text).toContain('could not check');
    // Se sigue sin ofrecer: proponer un enlace que el backend va a rechazar es peor.
    expect(fixture.componentInstance.accessOptions.some(o => o.id === 'Public')).toBe(false);
  });
});
