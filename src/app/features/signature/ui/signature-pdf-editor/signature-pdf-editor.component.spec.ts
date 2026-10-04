import { TestBed } from '@angular/core/testing';
import { SimpleChange, signal } from '@angular/core';
import { of } from 'rxjs';
import { SignaturePdfEditorComponent } from './signature-pdf-editor.component';
import { SignatureStore } from '../../data-access/signature.store';
import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/auth/permission.service';
import {
  EditorSeed,
  PREPARER_PARTY_ID,
  PlacedField,
  WizardClient,
  WizardDocument,
} from '../signature-request-panel/signature-wizard.model';
import { defaultRules } from '../signature-request-panel/signature-wizard.presenter';
import { RenderedPage, blankPages } from '../../utils/pdf-render.util';

/** Stub mínimo del store: el editor solo lee firmas/clientes y pide URLs de descarga. */
function storeStub() {
  const profiles = signal<unknown[]>([]);
  return {
    loadSignatureProfiles: vi.fn(),
    signatureProfiles: profiles,
    activeSignatureProfiles: profiles,
    defaultSignatureProfile: signal(null),
    getDownloadUrl: vi.fn(() => of('blob:x')),
    queryCustomers: vi.fn(),
    loadCustomers: vi.fn(),
    customers: signal([]),
    customersLoading: signal(false),
    customersError: signal<string | null>(null),
  };
}

function client(id: string, name = 'Ana Martinez'): WizardClient {
  return {
    id,
    displayName: name,
    email: `${id}@x.com`,
    phone: '',
    type: 'individual',
    isActive: true,
    createdAt: '',
  };
}

/** Documento no-PDF: el editor usa páginas carta en blanco (render síncrono, sin pdf.js). */
function blankDoc(id = 'doc-1'): WizardDocument {
  return { id, name: 'Engagement.docx', kind: 'doc', size: '', date: '', blob: null, fileId: id };
}

describe('SignaturePdfEditorComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [SignaturePdfEditorComponent],
      providers: [
        { provide: SignatureStore, useValue: storeStub() },
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        { provide: PermissionService, useValue: { has: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(SignaturePdfEditorComponent);
    const c = fixture.componentInstance;
    const set = (changes: Partial<Record<'client' | 'document' | 'seed', unknown>>): void => {
      const simple: Record<string, SimpleChange> = {};
      for (const [key, value] of Object.entries(changes)) {
        (c as unknown as Record<string, unknown>)[key] = value;
        simple[key] = new SimpleChange(undefined, value, false);
      }
      c.ngOnChanges(simple);
      fixture.detectChanges();
    };
    return { c, fixture, set };
  }

  function el(fixture: { nativeElement: HTMLElement }, testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  describe('pantallas angostas (390px)', () => {
    let originalWidth: number;
    beforeEach(() => {
      originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    });
    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    });

    it('existen los disparadores de Signers / Fields / checklist y abren su contenido', () => {
      const { fixture, set } = setup();
      set({ client: client('1'), document: blankDoc() });

      for (const id of [
        'mobile-signers-trigger',
        'mobile-fields-trigger',
        'mobile-zoom-trigger',
        'mobile-checklist-trigger',
        'narrow-signers-trigger',
        'narrow-fields-trigger',
        'narrow-checklist-trigger',
      ]) {
        expect(el(fixture, id), id).not.toBeNull();
      }

      el(fixture, 'mobile-signers-trigger')!.click();
      fixture.detectChanges();
      expect(el(fixture, 'narrow-panel-signers')?.textContent).toContain('Add signer');
      expect(el(fixture, 'narrow-panel-signers')?.textContent).toContain('Ana Martinez');

      el(fixture, 'mobile-fields-trigger')!.click();
      fixture.detectChanges();
      expect(
        el(fixture, 'narrow-panel-fields')?.querySelector('[data-testid="palette-signature"]'),
      ).not.toBeNull();

      el(fixture, 'mobile-checklist-trigger')!.click();
      fixture.detectChanges();
      expect(el(fixture, 'narrow-panel-checklist')?.textContent).toContain('Before you continue');
    });

    it('con un campo seleccionado, el inspector aparece como hoja inferior con todas sus acciones', () => {
      const { c, fixture, set } = setup();
      set({ client: client('1'), document: blankDoc() });
      c.addField('text');
      fixture.detectChanges();

      const sheet = el(fixture, 'sheet-inspector');
      expect(sheet).not.toBeNull();
      const text = sheet!.textContent ?? '';
      for (const action of [
        'Duplicate',
        'Duplicate to all pages',
        'Delete field',
        'Signer',
        'Label',
      ]) {
        expect(text).toContain(action);
      }
    });

    it('colocar con un toque: se arma el tipo, se cierra el panel y se coloca en la página visible', () => {
      const { c, fixture, set } = setup();
      set({ client: client('1'), document: blankDoc() });
      c.toggleNarrowPanel('fields');
      c.armPlacement('initials');
      fixture.detectChanges();
      expect(c.narrowPanel()).toBeNull();
      expect(el(fixture, 'placing-hint')).not.toBeNull();
      c.placeOnCurrentPage();
      expect(c.fields().map((f) => f.type)).toEqual(['initials']);
      expect(c.placingType()).toBeNull();
    });
  });

  it('ids tras restaurar un snapshot: la secuencia sigue por encima del mayor sufijo (sin duplicados)', () => {
    const { c, set } = setup();
    const seed: EditorSeed = {
      signers: [
        {
          id: 'client:1',
          name: 'Ana',
          email: 'a@x.com',
          color: 'bg-indigo-500',
          channel: 'email',
          phone: '',
          language: 'En',
        },
        {
          id: 'signer-2',
          name: 'Luis',
          email: 'l@x.com',
          color: 'bg-orange-500',
          channel: 'email',
          phone: '',
          language: 'En',
        },
      ],
      fields: [
        {
          localId: 'field-3',
          type: 'signature',
          page: 1,
          nx: 0.1,
          ny: 0.1,
          nw: 0.2,
          nh: 0.05,
          signerLocalId: 'client:1',
        },
        {
          localId: 'prep-5',
          type: 'signature',
          page: 1,
          nx: 0.5,
          ny: 0.5,
          nw: 0.2,
          nh: 0.05,
          signerLocalId: PREPARER_PARTY_ID,
        },
      ],
      rules: defaultRules(),
    };
    set({ seed, client: client('1'), document: blankDoc() });
    expect(c.fields().map((f) => f.id)).toEqual(['field-3', 'prep-5']);

    c.addField('date');
    const ids = c.fields().map((f) => f.id);
    expect(ids.at(-1)).toBe('field-6');
    expect(new Set(ids).size).toBe(ids.length);
    // El seed deja el editor "limpio" (nada que confirmar al cerrar).
    c.dirty.set(false);
    c.addField('text');
    expect(c.dirty()).toBe(true);
  });

  it('cambiar de cliente pasa sus campos al nuevo firmante cliente (con ids nuevos) — nunca huérfanos', () => {
    const { c, set } = setup();
    set({ client: client('old', 'Old Client'), document: blankDoc() });
    c.addField('signature');
    c.addField('date');
    const before = c.fields().map((f) => f.id);

    set({ client: client('new', 'New Client') });

    expect(c.signers().map((s) => s.id)).toEqual(['client:new']);
    expect(c.fields().every((f) => f.signerId === 'client:new')).toBe(true);
    expect(
      c
        .fields()
        .map((f) => f.id)
        .some((id) => before.includes(id)),
    ).toBe(false);
    expect(c.buildNormalizedFields().map((f) => f.signerLocalId)).toEqual([
      'client:new',
      'client:new',
    ]);
  });

  it('también en modo sembrado: mismo cliente no toca nada; cliente distinto reasigna', () => {
    const { c, set } = setup();
    const seed: EditorSeed = {
      signers: [
        {
          id: 'client:1',
          name: 'Ana',
          email: 'a@x.com',
          color: 'bg-indigo-500',
          channel: 'sms',
          phone: '+1 555',
          language: 'En',
        },
      ],
      fields: [
        {
          localId: 'seed-f1',
          type: 'signature',
          page: 1,
          nx: 0.1,
          ny: 0.1,
          nw: 0.2,
          nh: 0.05,
          signerLocalId: 'client:1',
        },
      ],
      rules: defaultRules(),
    };
    set({ seed, client: client('1'), document: blankDoc() });
    expect(c.signers()[0].channel).toBe('sms'); // no se pisó lo sembrado

    set({ client: client('2', 'Other') });
    expect(c.fields().map((f) => f.signerId)).toEqual(['client:2']);
    expect(c.fields()[0].id).not.toBe('seed-f1');
  });

  it('validación por firmante: los campos del preparador no cuentan y la lista dice a quién le falta', () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    c.signers.update((list) => [
      ...list,
      {
        id: 'signer-9',
        name: 'Luis',
        email: 'l@x.com',
        color: 'bg-orange-500',
        channel: 'email',
        phone: '',
        language: 'En',
      },
    ]);
    c.addField('signature'); // cliente
    c.fields.update((list) => [
      ...list,
      {
        id: 'prep-1',
        type: 'signature',
        page: 1,
        x: 10,
        y: 10,
        width: 100,
        height: 40,
        signerId: PREPARER_PARTY_ID,
      },
    ]);

    expect(c.canContinue()).toBe(false);
    const missing = c.readinessItems().filter((i) => i.kind === 'missing-signature');
    expect(missing.map((i) => i.signerId)).toEqual(['signer-9']);

    c.setActiveSigner('signer-9');
    c.addField('initials');
    expect(c.canContinue()).toBe(true);
  });

  it('duplicar y duplicar en todas las páginas crean campos normales', () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    c.addField('signature');
    const id = c.fields()[0].id;

    c.duplicateField(id);
    expect(c.fields()).toHaveLength(2);

    c.duplicateFieldToAllPages(id);
    expect(
      c
        .fields()
        .map((f) => f.page)
        .sort(),
    ).toEqual([1, 1, 2, 3]);
    expect(new Set(c.fields().map((f) => f.id)).size).toBe(4);
  });

  it('reasignar desde el inspector cambia firmante e id', () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    c.signers.update((list) => [
      ...list,
      {
        id: 'signer-9',
        name: 'Luis',
        email: 'l@x.com',
        color: '',
        channel: 'email',
        phone: '',
        language: 'En',
      },
    ]);
    c.addField('signature');
    const id = c.fields()[0].id;
    c.reassignField(id, 'signer-9');
    expect(c.fields()[0].signerId).toBe('signer-9');
    expect(c.fields()[0].id).not.toBe(id);
    expect(c.selectedFieldId()).toBe(c.fields()[0].id);
  });

  it('zoom: reescala los campos SOLO tras el render y la posición normalizada no cambia', async () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    c.addField('signature');
    const normalizedBefore = c.buildNormalizedFields();
    const pxBefore = c.fields()[0];
    const pageBefore = c.pages()[0];

    c.zoomIn();
    await Promise.resolve();

    expect(c.zoom()).toBeCloseTo(1.2);
    expect(c.pages()[0].width).toBeGreaterThan(pageBefore.width);
    expect(c.fields()[0].width / c.pages()[0].width).toBeCloseTo(
      pxBefore.width / pageBefore.width,
      9,
    );
    expect(c.buildNormalizedFields()).toEqual(normalizedBefore);
  });

  it('zoom fallido: se queda el zoom anterior, los campos no se tocan y el aviso es amable', async () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    c.addField('signature');
    const before = c.fields();
    // Bytes basura: pdf.js (o su carga en jsdom) rechaza el re-render.
    (c as unknown as { docBytes: Uint8Array }).docBytes = new Uint8Array([1, 2, 3]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await (c as unknown as { applyZoom(z: number): Promise<void> }).applyZoom(1.4);
    spy.mockRestore();

    expect(c.zoom()).toBe(1);
    expect(c.pendingZoom()).toBeNull();
    expect(c.fields()).toBe(before);
    expect(c.zoomError()).toBe("We couldn't change the zoom. Try again.");
  }, 20000);

  it('el tamaño por defecto de un campo nuevo sigue al zoom (mismo tamaño en el PDF)', async () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    c.addField('signature');
    const atOne = c.buildNormalizedFields()[0];
    await (c as unknown as { applyZoom(z: number): Promise<void> }).applyZoom(2);
    c.addField('signature');
    const atTwo = c.buildNormalizedFields()[1];
    expect(atTwo.width).toBeCloseTo(atOne.width, 3);
    expect(atTwo.height).toBeCloseTo(atOne.height, 3);
  });

  it('render fallido: sin páginas falsas, no se puede colocar ni exportar, mensaje amable y Retry', async () => {
    const { c, fixture, set } = setup();
    const broken: WizardDocument = {
      id: 'bad',
      name: 'bad.pdf',
      kind: 'pdf',
      size: '',
      date: '',
      blob: {
        arrayBuffer: () => Promise.reject(new Error('InvalidPDFException: Invalid PDF structure')),
      } as unknown as Blob,
      fileId: 'bad',
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    set({ client: client('1'), document: broken });
    await fixture.whenStable();
    fixture.detectChanges();
    spy.mockRestore();

    expect(c.loadError()).toBe("We couldn't open this PDF. Try again or upload another file.");
    expect(c.pages()).toEqual([]);
    expect(c.canPlace()).toBe(false);
    expect(c.safeToExport()).toBe(false);
    expect(c.readinessItems()[0].kind).toBe('render-failed');
    expect(el(fixture, 'render-error')?.textContent).toContain('Retry');
    expect(fixture.nativeElement.textContent).not.toContain('InvalidPDFException');
  });

  it('Escape: cierra primero lo del editor (selección, colocación) antes que el wizard', () => {
    const { c, set } = setup();
    set({ client: client('1'), document: blankDoc() });
    expect(c.handleEscape()).toBe(false);
    c.addField('date');
    expect(c.handleEscape()).toBe(true);
    expect(c.selectedFieldId()).toBeNull();
    c.armPlacement('text');
    expect(c.handleEscape()).toBe(true);
    expect(c.placingType()).toBeNull();
  });

  it('el canal del firmante ofrece también un canal sembrado desconocido (p. ej. "app")', () => {
    const { c } = setup();
    const opts = c.channelOptionsFor({
      id: 'x',
      name: 'X',
      email: '',
      color: '',
      channel: 'app',
      phone: '',
      language: 'En',
    });
    expect(opts).toContain('app');
    expect(opts).toContain('email');
  });

  describe('paridad del payload normalizado (antes/después del refactor)', () => {
    /** Copia literal de buildNormalizedFields previo al refactor (commit 01ede14^). */
    function legacyNormalize(fields: PlacedField[], pages: RenderedPage[]) {
      const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
      const round = (value: number): number => Math.round(value * 10000) / 10000;
      const out: unknown[] = [];
      for (const field of fields) {
        if (field.signerId === PREPARER_PARTY_ID) {
          continue;
        }
        const page = pages.find((p) => p.page === field.page);
        if (!page || page.width <= 0 || page.height <= 0) {
          continue;
        }
        const x = round(clamp01(field.x / page.width));
        const y = round(clamp01(field.y / page.height));
        let width = round(clamp01(field.width / page.width));
        let height = round(clamp01(field.height / page.height));
        if (x + width > 1) {
          width = round(1 - x);
        }
        if (y + height > 1) {
          height = round(1 - y);
        }
        if (width <= 0 || height <= 0) {
          continue;
        }
        out.push({
          localId: field.id,
          signerLocalId: field.signerId,
          type: field.type,
          page: field.page,
          x,
          y,
          width,
          height,
          label: field.type === 'text' ? field.label?.trim() || undefined : undefined,
        });
      }
      return out;
    }

    const FIXED: PlacedField[] = [
      {
        id: 'field-0',
        type: 'signature',
        page: 1,
        x: 120,
        y: 600,
        width: 240,
        height: 72,
        signerId: 'client:1',
      },
      {
        id: 'field-1',
        type: 'text',
        page: 2,
        x: 700,
        y: 900,
        width: 200,
        height: 80,
        signerId: 'client:1',
        label: ' SSN ',
      },
      {
        id: 'field-2',
        type: 'date',
        page: 3,
        x: 0,
        y: 0,
        width: 156,
        height: 48,
        signerId: 'signer-4',
      },
      {
        id: 'prep-3',
        type: 'signature',
        page: 1,
        x: 300,
        y: 300,
        width: 240,
        height: 72,
        signerId: PREPARER_PARTY_ID,
      },
    ];

    it.each([0.6, 1, 2])('mismo resultado que la implementación previa a zoom %s', (zoom) => {
      const { c } = setup();
      const pages = blankPages(3, 1.2 * zoom);
      const fields = FIXED.map((f) => ({
        ...f,
        x: f.x * zoom,
        y: f.y * zoom,
        width: f.width * zoom,
        height: f.height * zoom,
      }));
      c.pages.set(pages);
      c.fields.set(fields);
      expect(c.buildNormalizedFields()).toEqual(legacyNormalize(fields, pages));
    });

    it('golden: valores exactos que viajan al backend (no dependen del zoom aplicado)', async () => {
      const { c, set } = setup();
      set({ client: client('1'), document: blankDoc() });
      c.fields.set(
        FIXED.map((f) => ({ ...f, signerId: f.signerId === 'signer-4' ? 'client:1' : f.signerId })),
      );
      const golden = c.buildNormalizedFields();
      expect(golden).toEqual([
        {
          localId: 'field-0',
          signerLocalId: 'client:1',
          type: 'signature',
          page: 1,
          x: 0.1635,
          y: 0.6316,
          width: 0.327,
          height: 0.0758,
          label: undefined,
        },
        {
          localId: 'field-1',
          signerLocalId: 'client:1',
          type: 'text',
          page: 2,
          x: 0.9537,
          y: 0.9474,
          width: 0.0463,
          height: 0.0526,
          label: 'SSN',
        },
        {
          localId: 'field-2',
          signerLocalId: 'client:1',
          type: 'date',
          page: 3,
          x: 0,
          y: 0,
          width: 0.2125,
          height: 0.0505,
          label: undefined,
        },
      ]);
      expect(c.buildPreparerFields()).toEqual([
        {
          localId: 'prep-3',
          signerLocalId: PREPARER_PARTY_ID,
          type: 'signature',
          page: 1,
          x: 0.4087,
          y: 0.3158,
          width: 0.327,
          height: 0.0758,
        },
      ]);

      for (const zoom of [2, 0.6, 1]) {
        await (c as unknown as { applyZoom(z: number): Promise<void> }).applyZoom(zoom);
        const after = c.buildNormalizedFields();
        after.forEach((f, i) => {
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(f[key]).toBeCloseTo(golden[i][key], 3);
          }
        });
      }
    });
  });

  describe('arrastrar desde la paleta (mantener pulsado y soltar)', () => {
    const PAGE_LEFT = 100;
    const PAGE_TOP = 50;

    /** Las páginas reales no tienen layout en jsdom: se les da un rect (apiladas, 16px de hueco). */
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

    function down(button: HTMLElement): PointerEvent {
      return { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 20, currentTarget: button } as unknown as PointerEvent;
    }

    function move(x: number, y: number, type = 'pointermove'): void {
      window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
    }

    function ready() {
      const ctx = setup();
      ctx.set({ client: client('1'), document: blankDoc() });
      ctx.fixture.detectChanges();
      stubPageRects();
      const button = el(ctx.fixture, 'palette-signature')!;
      return { ...ctx, button };
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('soltar sobre una página crea UN campo centrado en el punto, igual que el clic, y lo selecciona', () => {
      vi.useFakeTimers();
      const { c, fixture, button } = ready();
      c.onPalettePointerDown(down(button), 'signature');
      move(200, 200);
      fixture.detectChanges();
      // Fantasma visible (colgado de body) con la etiqueta del campo.
      const ghost = document.body.querySelector<HTMLElement>('[data-testid="palette-ghost"]')!;
      expect(ghost.classList.contains('hidden')).toBe(false);
      expect(ghost.textContent).toContain('Signature');

      // Un frame sobre la página: vista previa en la página 1.
      move(PAGE_LEFT + 300, PAGE_TOP + 200);
      vi.advanceTimersByTime(20);
      fixture.detectChanges();
      expect(c.dropPreview()?.page).toBe(1);
      expect(el(fixture, 'drop-preview')).not.toBeNull();

      move(PAGE_LEFT + 300, PAGE_TOP + 200, 'pointerup');
      expect(c.fields()).toHaveLength(1);
      const field = c.fields()[0];
      expect(field).toMatchObject({ type: 'signature', page: 1, signerId: 'client:1', x: 200, y: 170, width: 200, height: 60 });
      expect(c.selectedFieldId()).toBe(field.id);
      expect(c.liveMessage()).toBe('Signature field placed on page 1');
      // El click que llega tras soltar no arma "clic para colocar".
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(c.placingType()).toBeNull();
      vi.runAllTimers();
      expect(c.paletteGhost()).toBeNull();

      // Misma caja normalizada que colocar con un clic en el mismo punto.
      const dragged = c.buildNormalizedFields()[0];
      c.removeField(field.id);
      c.armPlacement('signature');
      const pageEl = fixture.nativeElement.querySelector('[data-page="1"]') as HTMLElement;
      c.onPagePointerDown(
        { clientX: PAGE_LEFT + 300, clientY: PAGE_TOP + 200, currentTarget: pageEl, preventDefault: () => undefined } as unknown as PointerEvent,
        c.pages()[0],
      );
      const clicked = c.buildNormalizedFields()[0];
      expect({ ...clicked, localId: '' }).toEqual({ ...dragged, localId: '' });
    });

    it('soltar fuera de las páginas no crea nada (vuelve a la paleta)', () => {
      vi.useFakeTimers();
      const { c, button } = ready();
      c.onPalettePointerDown(down(button), 'initials');
      move(60, 60);
      move(5, 5, 'pointerup');
      expect(c.fields()).toHaveLength(0);
      expect(c.paletteGhost()?.phase).toBe('return');
      vi.runAllTimers();
      expect(c.paletteGhost()).toBeNull();
    });

    it('Escape cancela el arrastre: nada se crea aunque luego se suelte sobre la página', () => {
      const { c, button } = ready();
      c.onPalettePointerDown(down(button), 'date');
      move(PAGE_LEFT + 100, PAGE_TOP + 100);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      move(PAGE_LEFT + 100, PAGE_TOP + 100, 'pointerup');
      expect(c.fields()).toHaveLength(0);
    });

    it('bloqueado (render/zoom en curso): el arrastre no arranca y se ve el mismo motivo', () => {
      const { c, button } = ready();
      c.loading.set(true);
      c.onPalettePointerDown(down(button), 'signature');
      move(PAGE_LEFT + 100, PAGE_TOP + 100);
      move(PAGE_LEFT + 100, PAGE_TOP + 100, 'pointerup');
      expect(c.paletteGhost()).toBeNull();
      expect(c.fields()).toHaveLength(0);
      expect(c.placeDisabledReason()).toBe('Loading the document…');
    });
  });
});
