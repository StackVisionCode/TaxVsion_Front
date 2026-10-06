import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { SignatureService } from '../../data-access/signature.service';
import { SignatureTemplateDetail } from '../../data-access/signature.model';
import { SignatureTemplateEditorComponent } from './signature-template-editor.component';
import { SignatureCategoryPickerComponent } from '../signature-category-picker/signature-category-picker.component';

function detail(partial: Partial<SignatureTemplateDetail> = {}): SignatureTemplateDetail {
  return {
    id: 't1',
    title: 'Form 8879',
    description: null,
    category: 'Fiscal',
    status: 'Draft',
    defaultTokenExpirationHours: 168,
    requiresSequentialSigning: false,
    requiresConsent: true,
    generateCertificate: true,
    sendSealedDocumentToSigners: true,
    sendCertificateToSigners: false,
    autoRemindersEnabled: true,
    reminderIntervalHours: 48,
    requiresPractitionerPin: false,
    baseDocumentFileId: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    publishedAtUtc: null,
    slots: [
      { id: 's-client', order: 1, role: 'Client', defaultLanguage: 'En', requiredVerificationMethod: null },
      { id: 's-spouse', order: 2, role: 'Spouse', defaultLanguage: 'En', requiredVerificationMethod: null },
    ],
    fields: [
      {
        id: 'srv-a',
        slotOrder: 1,
        kind: 'Signature',
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.25,
        height: 0.06,
        label: null,
        isRequired: true,
      },
    ],
    preparerFields: [],
    ...partial,
  };
}

/** Deja correr las promesas encadenadas (carga, recarga, superficie). */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

describe('SignatureTemplateEditorComponent', () => {
  let current: SignatureTemplateDetail;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  async function setup(initial = detail()) {
    current = initial;
    service = {
      getTemplate: vi.fn(() => of(current)),
      updateTemplateMetadata: vi.fn(() => of(undefined)),
      updateTemplateDefaults: vi.fn(() => of(undefined)),
      setTemplatePractitionerPin: vi.fn(() => of(undefined)),
      clearTemplatePractitionerPin: vi.fn(() => of(undefined)),
      updateTemplateSlot: vi.fn(() => of(undefined)),
      removeTemplateSlot: vi.fn(() => of(undefined)),
      removeTemplateField: vi.fn(() => of(undefined)),
      removeTemplatePreparerField: vi.fn(() => of(undefined)),
      placeTemplateField: vi.fn(() => of({ id: 'new', slotOrder: 1 })),
      placeTemplatePreparerField: vi.fn(() => of({ id: 'new-p' })),
      publishTemplate: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      imports: [SignatureTemplateEditorComponent],
      providers: [{ provide: SignatureService, useValue: service }],
    });
    // Sin plantilla: se prueba la lógica, no el markup (y no se cargan los hijos).
    TestBed.overrideComponent(SignatureTemplateEditorComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(SignatureTemplateEditorComponent);
    const c = fixture.componentInstance;
    c.templateId = 't1';
    c.ngOnChanges({ templateId: new SimpleChange(null, 't1', true) });
    await settle();
    return c;
  }

  it('con el markup real: pestañas Document | Settings, acordeón e inspector con sus acciones', async () => {
    current = detail();
    service = { getTemplate: vi.fn(() => of(current)) };
    TestBed.configureTestingModule({
      imports: [SignatureTemplateEditorComponent],
      providers: [{ provide: SignatureService, useValue: service }],
    });
    // El selector de categoría necesita el store de la feature: se deja como elemento desconocido.
    TestBed.overrideComponent(SignatureTemplateEditorComponent, {
      remove: { imports: [SignatureCategoryPickerComponent] },
    });
    const fixture = TestBed.createComponent(SignatureTemplateEditorComponent);
    const c = fixture.componentInstance;
    c.templateId = 't1';
    c.ngOnChanges({ templateId: new SimpleChange(null, 't1', true) });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Pestañas (visibles < lg) y el acordeón con "Signer roles" abierto por defecto.
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map(b => b.textContent?.trim());
    expect(tabs).toEqual(['Document', 'Settings']);
    expect(el.querySelector('aside')?.classList.contains('hidden')).toBe(true);
    (el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]).click();
    fixture.detectChanges();
    expect(el.querySelector('aside')?.classList.contains('hidden')).toBe(false);
    expect(el.querySelectorAll('aside section button[aria-expanded="true"]')).toHaveLength(1);

    // Volver al documento y seleccionar un campo: aparece el inspector.
    (el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]).click();
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Field inspector"]')).toBeNull();
    const fieldEl = el.querySelector<HTMLElement>('[data-field]')!;
    fieldEl.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    const inspector = el.querySelector('[aria-label="Field inspector"]')!;
    expect(inspector).toBeTruthy();
    const actions = Array.from(inspector.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(actions).toEqual(expect.arrayContaining(['Duplicate', 'Copy to all pages', 'Delete']));
    expect(inspector.querySelector('#insp-role')).toBeTruthy();

    // Teclado: Ctrl+D duplica, Supr elimina, Esc deselecciona.
    fieldEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    expect(c.fields()).toHaveLength(2);
    const copyId = c.selectedId()!;
    c.onFieldKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }), c.selectedField()!);
    expect(c.selectedField()!.x).toBeCloseTo(c.fields()[0].x + 16 * c.zoom() + 10, 6);
    c.onFieldKeydown(new KeyboardEvent('keydown', { key: 'Delete' }), c.selectedField()!);
    expect(c.fields().some(f => f.localId === copyId)).toBe(false);
    c.selectField(c.fields()[0].localId);
    c.onFieldKeydown(new KeyboardEvent('keydown', { key: 'Escape' }), c.fields()[0]);
    expect(c.selectedId()).toBeNull();
  });

  it('carga el layout del server en px de la superficie (sin cambios pendientes)', async () => {
    const c = await setup();
    expect(c.fields()).toHaveLength(1);
    expect(c.fields()[0].x).toBeCloseTo(0.1 * c.pages()[0].width, 6);
    expect(c.layoutDirty()).toBe(false);
    expect(c.canEdit()).toBe(true);
  });

  it('guardar los detalles con layout sin guardar CONSERVA el layout local', async () => {
    const c = await setup();
    c.setActiveSlot(2);
    c.addField('initials');
    const before = c.fields();
    expect(c.layoutDirty()).toBe(true);

    await c.saveDetails();
    await settle();

    expect(service['getTemplate']).toHaveBeenCalledTimes(2);
    expect(c.fields()).toEqual(before);
    expect(c.layoutDirty()).toBe(true);
  });

  it('defaults: generateCertificate siempre true y "email certificate" independiente (plantilla vieja sin certificado)', async () => {
    const c = await setup(detail({ generateCertificate: false, sendCertificateToSigners: false }));
    c.sendCertificate.set(true);
    await c.saveDetails();
    await settle();
    expect(service['updateTemplateDefaults']).toHaveBeenCalledWith('t1', {
      defaultTokenExpirationHours: 168,
      requiresSequentialSigning: false,
      requiresConsent: true,
      generateCertificate: true,
      sendSealedDocumentToSigners: true,
      sendCertificateToSigners: true,
      autoRemindersEnabled: true,
      reminderIntervalHours: 48,
    });
  });

  it('con el markup real: el inspector (xl) se pliega, se recuerda y no se reabre al seleccionar', async () => {
    localStorage.clear();
    current = detail();
    service = { getTemplate: vi.fn(() => of(current)) };
    TestBed.configureTestingModule({
      imports: [SignatureTemplateEditorComponent],
      providers: [{ provide: SignatureService, useValue: service }],
    });
    TestBed.overrideComponent(SignatureTemplateEditorComponent, {
      remove: { imports: [SignatureCategoryPickerComponent] },
    });
    const fixture = TestBed.createComponent(SignatureTemplateEditorComponent);
    const c = fixture.componentInstance;
    c.templateId = 't1';
    c.ngOnChanges({ templateId: new SimpleChange(null, 't1', true) });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    // Sin generar certificado no hay switch; "Email certificate" ya no depende de él.
    c.openSection.set('defaults');
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Generate certificate');
    expect(el.textContent).toContain('Email certificate to signers');

    c.selectField(c.fields()[0].localId);
    fixture.detectChanges();
    expect(q('tpl-inspector')?.classList.contains('xl:hidden')).toBe(false);
    q('tpl-inspector-collapse')!.click();
    fixture.detectChanges();
    expect(localStorage.getItem('signature.templateEditor.inspectorCollapsed')).toBe('1');
    expect(q('tpl-inspector')?.classList.contains('xl:hidden')).toBe(true);
    expect(c.selectedField()).not.toBeNull(); // plegar no deselecciona

    // Otro campo seleccionado: sigue plegada (< xl el panel inferior/flotante no cambia) y hay botón para reabrir.
    c.selectField(null);
    c.selectField(c.fields()[0].localId);
    fixture.detectChanges();
    expect(q('tpl-inspector')?.classList.contains('xl:hidden')).toBe(true);
    q('tpl-inspector-reopen')!.click();
    fixture.detectChanges();
    expect(q('tpl-inspector')?.classList.contains('xl:hidden')).toBe(false);
    expect(localStorage.getItem('signature.templateEditor.inspectorCollapsed')).toBeNull();
    localStorage.clear();
  });

  it('quitar un rol con layout sin guardar: se traduce por slot.id y se descartan los campos del rol quitado', async () => {
    const c = await setup();
    c.setActiveSlot(2);
    c.addField('signature'); // Spouse
    c.setActiveSlot(1);
    c.addField('date'); // Client
    // Tras quitar Client, el backend renumera: Spouse pasa a order 1.
    current = detail({
      slots: [{ id: 's-spouse', order: 1, role: 'Spouse', defaultLanguage: 'En', requiredVerificationMethod: null }],
      fields: [],
    });

    await c.removeSlot(1);
    await settle();

    expect(c.fields().map(f => [f.type, f.slotOrder])).toEqual([['signature', 1]]);
    expect(c.layoutDirty()).toBe(true);
  });

  it('sin cambios pendientes, una acción que recarga trae el layout del server', async () => {
    const c = await setup();
    current = detail({ fields: [] });
    await c.updateSlot(c.slots()[0], { defaultLanguage: 'Es' });
    await settle();
    expect(c.fields()).toEqual([]);
    expect(c.layoutDirty()).toBe(false);
  });

  it('saveLayout que falla a mitad: recarga, conserva el layout local y avisa para reintentar', async () => {
    const c = await setup();
    c.setActiveSlot(2);
    c.addField('signature');
    const local = c.fields();
    let calls = 0;
    service['placeTemplateField'].mockImplementation(() =>
      ++calls === 2 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of({ id: `n-${calls}`, slotOrder: 1 }),
    );
    // Lo que el server tiene tras el fallo: el campo viejo borrado y el primero re-posteado.
    current = detail({ fields: [{ ...detail().fields[0], id: 'n-1' }] });

    await c.saveLayout();
    await settle();

    expect(c.error()).toContain('only partly saved');
    expect(c.layoutDirty()).toBe(true);
    expect(c.fields()).toEqual(local);
    // El reintento borra lo que de verdad hay en el server ahora (n-1), no ids viejos.
    service['placeTemplateField'].mockImplementation(() => of({ id: 'ok', slotOrder: 1 }));
    service['removeTemplateField'].mockClear();
    await c.saveLayout();
    expect(service['removeTemplateField'].mock.calls.map(args => args[1])).toEqual(['n-1']);
  });

  it('un 404 al borrar un campo ya borrado no rompe el reintento', async () => {
    const c = await setup();
    c.addField('date');
    service['removeTemplateField'].mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    await c.saveLayout();
    expect(c.error()).toBe('');
    expect(service['placeTemplateField']).toHaveBeenCalledTimes(2);
  });

  it('publicar exige firma o iniciales por cada rol firmante; la del preparador no cuenta', async () => {
    const c = await setup(detail({ fields: [] }));
    c.addPreparerField('signature');
    expect(c.canPublish()).toBe(false);
    expect(c.rolesWithoutSignature()).toEqual(['Client', 'Spouse']);

    c.setActiveSlot(1);
    c.addField('signature');
    c.setActiveSlot(2);
    c.addField('initials');
    expect(c.rolesWithoutSignature()).toEqual([]);
    // Aún sin guardar: sigue bloqueado y lo dice.
    expect(c.publishBlockers()).toEqual(['Save the layout to enable publishing.']);

    await c.saveLayout();
    await settle();
    // El server devuelve el layout guardado.
    expect(c.layoutDirty()).toBe(false);
  });

  it('fuera de Draft no se puede editar el layout', async () => {
    const c = await setup(detail({ status: 'Published' }));
    const before = c.fields();
    c.removeField(before[0].localId);
    c.addField('signature');
    c.setFieldLabel(before[0].localId, 'x');
    expect(c.fields()).toEqual(before);
    expect(c.layoutDirty()).toBe(false);
  });

  it('duplicar y copiar a todas las páginas crean campos nuevos', async () => {
    const c = await setup(
      detail({
        fields: [
          { ...detail().fields[0], id: 'p1', page: 1 },
          { ...detail().fields[0], id: 'p3', page: 3, kind: 'Initials' },
        ],
      }),
    );
    expect(c.pages()).toHaveLength(3);
    const src = c.fields()[0];
    c.duplicate(src.localId);
    expect(c.fields()).toHaveLength(3);
    expect(c.selectedId()).not.toBe(src.localId);

    c.duplicateToAllPages(src.localId);
    expect(c.fields().filter(f => f.type === 'signature').map(f => f.page).sort()).toEqual([1, 1, 2, 3]);
    expect(new Set(c.fields().map(f => f.localId)).size).toBe(c.fields().length);
    expect(c.layoutDirty()).toBe(true);
  });

  describe('arrastrar desde la paleta (mantener pulsado y soltar)', () => {
    const PAGE_LEFT = 40;
    const PAGE_TOP = 120;

    function stubPageRects(): void {
      const original = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const page = (this as HTMLElement).dataset?.['page'];
        if (!page) {
          return original.call(this);
        }
        const el = this as HTMLElement;
        const w = parseFloat(el.style.width);
        const h = parseFloat(el.style.height);
        const top = PAGE_TOP + (Number(page) - 1) * (h + 16);
        return { left: PAGE_LEFT, top, width: w, height: h, right: PAGE_LEFT + w, bottom: top + h, x: PAGE_LEFT, y: top, toJSON: () => ({}) } as DOMRect;
      });
    }

    async function ready(initial = detail()) {
      current = initial;
      service = { getTemplate: vi.fn(() => of(current)) };
      TestBed.configureTestingModule({
        imports: [SignatureTemplateEditorComponent],
        providers: [{ provide: SignatureService, useValue: service }],
      });
      TestBed.overrideComponent(SignatureTemplateEditorComponent, {
        remove: { imports: [SignatureCategoryPickerComponent] },
      });
      const fixture = TestBed.createComponent(SignatureTemplateEditorComponent);
      const c = fixture.componentInstance;
      c.templateId = 't1';
      c.ngOnChanges({ templateId: new SimpleChange(null, 't1', true) });
      await settle();
      fixture.detectChanges();
      stubPageRects();
      const el = fixture.nativeElement as HTMLElement;
      const button = (testId: string) => el.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
      return { c, fixture, el, button };
    }

    function down(button: HTMLElement): PointerEvent {
      return { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10, currentTarget: button } as unknown as PointerEvent;
    }

    function move(x: number, y: number, type = 'pointermove'): void {
      window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('soltar sobre la página crea UN campo del rol activo centrado en el punto y lo selecciona', async () => {
      const { c, button } = await ready();
      vi.useFakeTimers();
      const before = c.fields().length;
      c.onPalettePointerDown(down(button('tpl-palette-initials')), 'initials');
      move(60, 60);
      expect(c.paletteGhost()?.phase).toBe('drag');
      move(PAGE_LEFT + 250, PAGE_TOP + 300, 'pointerup');
      expect(c.fields()).toHaveLength(before + 1);
      const created = c.selectedField()!;
      expect(created).toMatchObject({ type: 'initials', slotOrder: 1, page: 1, x: 250 - 45, y: 300 - 25, width: 90, height: 50 });
      expect(c.layoutDirty()).toBe(true);
      expect(c.liveMessage()).toBe('Initials field placed on page 1');
      vi.runAllTimers();
      expect(c.paletteGhost()).toBeNull();
    });

    it('preparador: el campo cae sin rol (PREPARER_SLOT)', async () => {
      const { c, button } = await ready();
      c.onPalettePointerDown(down(button('tpl-palette-preparer-signature')), 'signature', true);
      move(60, 60);
      move(PAGE_LEFT + 5, PAGE_TOP + 5, 'pointerup');
      expect(c.selectedField()).toMatchObject({ slotOrder: 0, x: 0, y: 0 });
    });

    it('fuera de la página o con Escape no se crea nada', async () => {
      const { c, button } = await ready();
      const before = c.fields().length;
      c.onPalettePointerDown(down(button('tpl-palette-date')), 'date');
      move(60, 60);
      move(5, 5, 'pointerup');
      c.onPalettePointerDown(down(button('tpl-palette-date')), 'date');
      move(60, 60);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      move(PAGE_LEFT + 100, PAGE_TOP + 100, 'pointerup');
      expect(c.fields()).toHaveLength(before);
    });

    it('plantilla publicada (no Draft): el arrastre no arranca', async () => {
      const { c, button } = await ready(detail({ status: 'Published' }));
      const before = c.fields().length;
      c.onPalettePointerDown(down(button('tpl-palette-signature') ?? document.createElement('button')), 'signature');
      move(60, 60);
      move(PAGE_LEFT + 100, PAGE_TOP + 100, 'pointerup');
      expect(c.paletteGhost()).toBeNull();
      expect(c.fields()).toHaveLength(before);
    });
  });
});
