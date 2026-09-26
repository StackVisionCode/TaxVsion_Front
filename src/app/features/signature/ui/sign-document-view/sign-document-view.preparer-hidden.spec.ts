import { TestBed } from '@angular/core/testing';
import { SignDocumentViewComponent } from './sign-document-view.component';
import { PublicSignerFieldView } from '../../data-access/public-signature.model';

/**
 * Invariante 14.5 F6: el firmante NUNCA ve la firma del preparador. Su vista solo recibe SUS campos
 * (contrato público `PublicSignerFieldView`, que no tiene noción de preparador). Este test bloquea que
 * en el futuro se cuele algún marcador de firma del preparador en la hoja del firmante.
 */
describe('SignDocumentViewComponent — signer never sees the preparer signature', () => {
  function mount(fields: PublicSignerFieldView[]): HTMLElement {
    TestBed.configureTestingModule({ imports: [SignDocumentViewComponent] });
    const fixture = TestBed.createComponent(SignDocumentViewComponent);
    fixture.componentInstance.fields = fields;
    fixture.componentInstance.editable = true;
    fixture.componentInstance.ngOnChanges();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the signer field but no preparer signature marker', () => {
    const el = mount([
      { id: 'f1', kind: 'Signature', page: 1, x: 0.1, y: 0.5, width: 0.2, height: 0.05, label: null, isRequired: true },
    ]);

    // El componente montó y renderizó contenido de la hoja del firmante.
    expect(el.querySelectorAll('*').length).toBeGreaterThan(0);

    // NADA que aluda a la firma del preparador.
    expect(el.querySelector('img[alt="Preparer signature"]')).toBeNull();
    expect(el.textContent ?? '').not.toContain('Preparer');
  });
});
