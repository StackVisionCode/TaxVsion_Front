import { TestBed } from '@angular/core/testing';
import {
  FieldValueChange,
  SignDocumentViewComponent,
  groupFieldsByPage,
} from './sign-document-view.component';
import { PublicSignerFieldView } from '../../data-access/public-signature.model';

function field(
  partial: Partial<PublicSignerFieldView> & Pick<PublicSignerFieldView, 'id'>,
): PublicSignerFieldView {
  return {
    documentId: 'doc-1',
    kind: 'Text',
    page: 1,
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.04,
    label: null,
    isRequired: true,
    ...partial,
  };
}

describe('groupFieldsByPage', () => {
  it('agrupa por página en orden y ordena cada página de arriba abajo', () => {
    const pages = groupFieldsByPage([
      field({ id: 'c', page: 2, y: 0.5 }),
      field({ id: 'b', page: 1, y: 0.8 }),
      field({ id: 'a', page: 1, y: 0.2 }),
    ]);
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0].fields.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('SignDocumentViewComponent', () => {
  function setup(
    fields: PublicSignerFieldView[],
    editable: boolean,
    values: Record<string, string> = {},
  ) {
    const fixture = TestBed.createComponent(SignDocumentViewComponent);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput('editable', editable);
    fixture.componentRef.setInput('values', values);
    fixture.detectChanges();
    return fixture;
  }

  it('coloca cada campo en su posición normalizada sobre la hoja', () => {
    const fixture = setup([field({ id: 't1', x: 0.25, y: 0.5, width: 0.5, height: 0.05 })], true);
    const box = fixture.nativeElement.querySelector('.field-text') as HTMLElement;
    expect(box.style.left).toBe('25%');
    expect(box.style.top).toBe('50%');
    expect(box.style.width).toBe('50%');
  });

  it('los campos de texto son inputs editables al firmar y emiten el valor', () => {
    const fixture = setup([field({ id: 't1', label: 'Account number' })], true);
    const emitted: FieldValueChange[] = [];
    fixture.componentInstance.valueChange.subscribe((change) => emitted.push(change));

    const input = fixture.nativeElement.querySelector(
      'input[data-field-id="t1"]',
    ) as HTMLInputElement;
    expect(input.placeholder).toBe('Account number');
    input.value = '12345';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toEqual([{ fieldId: 't1', value: '12345' }]);
  });

  it('en revisión no hay inputs: muestra lo escrito o la etiqueta', () => {
    const fixture = setup([field({ id: 't1', label: 'Account number' })], false, { t1: '999' });
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('999');
  });

  it('cuenta los requeridos de texto pendientes', () => {
    const fixture = setup(
      [field({ id: 't1' }), field({ id: 't2' }), field({ id: 's1', kind: 'Signature' })],
      true,
      { t1: 'ok' },
    );
    expect(fixture.componentInstance.pendingRequired).toBe(1);
  });

  it('renderiza solo los campos del documento activo', () => {
    const fixture = TestBed.createComponent(SignDocumentViewComponent);
    fixture.componentRef.setInput('documentId', 'doc-2');
    fixture.componentRef.setInput('fields', [
      field({ id: 'd1', documentId: 'doc-1', label: 'First document' }),
      field({ id: 'd2', documentId: 'doc-2', label: 'Second document' }),
    ]);
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-field-id="d1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-field-id="d2"]')).not.toBeNull();
  });

  it('renderiza todas las paginas del PDF aunque una pagina no tenga campos', () => {
    const fixture = TestBed.createComponent(SignDocumentViewComponent);
    fixture.componentRef.setInput('fields', [field({ id: 'page-two', page: 2 })]);
    fixture.componentRef.setInput('pageImages', {
      1: 'data:image/png;base64,page-one',
      2: 'data:image/png;base64,page-two',
    });
    fixture.detectChanges();

    const pages = fixture.nativeElement.querySelectorAll('.page-wrap');
    const images = fixture.nativeElement.querySelectorAll('.page-image');
    expect(pages).toHaveLength(2);
    expect(pages[0].getAttribute('data-page')).toBe('1');
    expect(images).toHaveLength(2);
  });

  it('uses the rendered page ratio and selected zoom', () => {
    const fixture = TestBed.createComponent(SignDocumentViewComponent);
    fixture.componentRef.setInput('fields', [field({ id: 't1' })]);
    fixture.componentRef.setInput('pageImages', { 1: 'data:image/png;base64,page-one' });
    fixture.componentRef.setInput('pageAspectRatios', { 1: 0.75 });
    fixture.componentRef.setInput('zoomPercent', 125);
    fixture.detectChanges();

    const sheet = fixture.nativeElement.querySelector('.sheet') as HTMLElement;
    expect(sheet.style.width).toBe('125%');
    expect(sheet.style.getPropertyValue('--page-aspect-ratio')).toBe('0.75');
  });
});
