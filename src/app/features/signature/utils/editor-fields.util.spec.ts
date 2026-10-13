import {
  EditorSigner,
  PREPARER_PARTY_ID,
  PlacedField,
} from '../ui/signature-request-panel/signature-wizard.model';
import {
  ALIGN_MARGIN_RATIO,
  DUPLICATE_OFFSET,
  alignFieldOnPage,
  clampToPage,
  copyFieldToAllPages,
  documentsMissingSigningField,
  duplicateFieldRect,
  nudgeField,
  projectFieldToPage,
  reassignSignerFields,
  remapFieldsToPages,
  rescaleFields,
  rescaleFieldsBetweenPages,
  resizeFieldFromCenter,
  scaleFieldFromCenter,
  scaleSize,
  signerFieldCount,
  signersMissingSignature,
} from './editor-fields.util';
import { normalizeFieldRect } from './field-normalize.util';

function field(partial: Partial<PlacedField> & Pick<PlacedField, 'id'>): PlacedField {
  return {
    documentLocalId: 'doc-1',
    type: 'signature',
    page: 1,
    x: 100,
    y: 200,
    width: 200,
    height: 60,
    signerId: 'client:1',
    ...partial,
  };
}

function signer(id: string, name = id): EditorSigner {
  return {
    id,
    name,
    email: `${id}@x.com`,
    color: 'bg-indigo-500',
    channel: 'email',
    phone: '',
    language: 'En',
  };
}

const page1 = { page: 1, width: 734.4, height: 950.4 };
const page2 = { page: 2, width: 734.4, height: 950.4 };

describe('rescaleFields (zoom)', () => {
  it('escala posición y tamaño por el ratio y conserva la posición normalizada', () => {
    const before = [field({ id: 'f1' })];
    const after = rescaleFields(before, 2);
    expect(after[0]).toEqual({ ...before[0], x: 200, y: 400, width: 400, height: 120 });
    const big = { width: page1.width * 2, height: page1.height * 2 };
    expect(normalizeFieldRect(after[0], big)).toEqual(normalizeFieldRect(before[0], page1));
  });

  it('ratio 1 o inválido devuelve la misma lista', () => {
    const list = [field({ id: 'f1' })];
    expect(rescaleFields(list, 1)).toBe(list);
    expect(rescaleFields(list, Number.NaN)).toBe(list);
    expect(rescaleFields(list, 0)).toBe(list);
  });
});

describe('documentsMissingSigningField', () => {
  const documents = [{ id: 'doc-1' }, { id: 'doc-2' }];

  it('requires a real signature or initials field on every document', () => {
    const fields = [
      field({ id: 'a', documentLocalId: 'doc-1' }),
      field({ id: 'b', documentLocalId: 'doc-2', type: 'date' }),
      field({ id: 'p', documentLocalId: 'doc-2', signerId: PREPARER_PARTY_ID }),
    ];

    expect(documentsMissingSigningField(documents, fields)).toEqual([{ id: 'doc-2' }]);
  });

  it('accepts initials as a signing field', () => {
    const fields = [
      field({ id: 'a', documentLocalId: 'doc-1' }),
      field({ id: 'b', documentLocalId: 'doc-2', type: 'initials' }),
    ];

    expect(documentsMissingSigningField(documents, fields)).toEqual([]);
  });
});

describe('rescaleFieldsBetweenPages', () => {
  it('conserva exactamente la posición relativa aunque el render redondee el tamaño de página', () => {
    const oldPages = [{ page: 1, width: 734, height: 950 }];
    const newPages = [{ page: 1, width: 1469, height: 1901 }];
    const before = field({ id: 'f', x: 700, y: 900, width: 200, height: 80 });
    const [after] = rescaleFieldsBetweenPages([before], oldPages, newPages);
    expect(after.x / 1469).toBeCloseTo(700 / 734, 12);
    expect(after.height / 1901).toBeCloseTo(80 / 950, 12);
  });
});

describe('scaleSize', () => {
  it('los tamaños por defecto/mínimos siguen al zoom (mismo tamaño en el PDF)', () => {
    expect(scaleSize({ w: 200, h: 60 }, 0.6)).toEqual({ w: 120, h: 36 });
    expect(scaleSize({ w: 200, h: 60 }, 2)).toEqual({ w: 400, h: 120 });
  });
});

describe('clampToPage / nudgeField', () => {
  it('mete la caja dentro de la página', () => {
    expect(clampToPage(field({ id: 'f', x: -10, y: 2000 }), page1)).toMatchObject({
      x: 0,
      y: page1.height - 60,
    });
  });

  it('flechas mueven y respetan los bordes', () => {
    expect(nudgeField(field({ id: 'f', x: 5 }), -10, 1, page1)).toMatchObject({ x: 0, y: 201 });
  });
});

describe('duplicateFieldRect', () => {
  it('copia desplazada con id nuevo y mismo firmante/tipo', () => {
    const copy = duplicateFieldRect(
      field({ id: 'f1', label: 'SSN', type: 'text' }),
      page1,
      'field-9',
    );
    expect(copy).toMatchObject({
      id: 'field-9',
      x: 100 + DUPLICATE_OFFSET,
      y: 200 + DUPLICATE_OFFSET,
      signerId: 'client:1',
      type: 'text',
      label: 'SSN',
    });
  });

  it('en el borde se desplaza hacia arriba-izquierda', () => {
    const edge = field({ id: 'f1', x: page1.width - 200, y: page1.height - 60 });
    const copy = duplicateFieldRect(edge, page1, 'field-2');
    expect(copy.x).toBeCloseTo(page1.width - 200 - DUPLICATE_OFFSET);
    expect(copy.y).toBeCloseTo(page1.height - 60 - DUPLICATE_OFFSET);
  });
});

describe('copyFieldToAllPages', () => {
  it('crea un campo normal por cada OTRA página, en la misma posición relativa', () => {
    const page3 = { page: 3, width: 612, height: 792 };
    let n = 10;
    const copies = copyFieldToAllPages(
      field({ id: 'f1' }),
      [page1, page2, page3],
      () => `field-${n++}`,
    );
    expect(copies.map((c) => [c.id, c.page])).toEqual([
      ['field-10', 2],
      ['field-11', 3],
    ]);
    expect(normalizeFieldRect(copies[0], page2)).toEqual(
      normalizeFieldRect(field({ id: 'f1' }), page1),
    );
    expect(normalizeFieldRect(copies[1], page3)).toEqual(
      normalizeFieldRect(field({ id: 'f1' }), page1),
    );
  });

  it('documento de una página: no crea nada', () => {
    expect(copyFieldToAllPages(field({ id: 'f1' }), [page1], () => 'x')).toEqual([]);
  });
});

describe('reassignSignerFields (cambio de cliente)', () => {
  it('pasa los campos del cliente viejo al nuevo con ids NUEVOS y no toca el resto', () => {
    let n = 5;
    const fields = [
      field({ id: 'field-0', signerId: 'client:old' }),
      field({ id: 'field-1', signerId: 'signer-2' }),
      field({ id: 'seed-abc', signerId: 'client:old', type: 'date' }),
      field({ id: 'prep-3', signerId: PREPARER_PARTY_ID }),
    ];
    const out = reassignSignerFields(fields, 'client:old', 'client:new', () => `field-${n++}`);
    expect(out.map((f) => [f.id, f.signerId])).toEqual([
      ['field-5', 'client:new'],
      ['field-1', 'signer-2'],
      ['field-6', 'client:new'],
      ['prep-3', PREPARER_PARTY_ID],
    ]);
    expect(out.some((f) => f.signerId === 'client:old')).toBe(false);
  });

  it('mismo firmante: sin cambios', () => {
    const fields = [field({ id: 'a' })];
    expect(reassignSignerFields(fields, 'client:1', 'client:1', () => 'x')).toBe(fields);
  });
});

describe('remapFieldsToPages (re-elegir documento conservando campos)', () => {
  it('lleva cada campo a la misma posición relativa y descarta los de páginas inexistentes', () => {
    const oldPages = [page1, page2];
    const newPages = [{ page: 1, width: 612, height: 792 }];
    const { kept, dropped } = remapFieldsToPages(
      [field({ id: 'a' }), field({ id: 'b', page: 2 })],
      oldPages,
      newPages,
    );
    expect(kept.map((f) => f.id)).toEqual(['a']);
    expect(dropped.map((f) => f.id)).toEqual(['b']);
    expect(normalizeFieldRect(kept[0], newPages[0])).toEqual(
      normalizeFieldRect(field({ id: 'a' }), page1),
    );
  });
});

describe('signersMissingSignature (validación por firmante)', () => {
  const signers = [signer('client:1', 'Ana'), signer('signer-2', 'Luis')];

  it('cada firmante necesita Firma o Iniciales; Fecha/Texto no cuentan', () => {
    const fields = [
      field({ id: 'a', signerId: 'client:1' }),
      field({ id: 'b', signerId: 'signer-2', type: 'date' }),
    ];
    expect(signersMissingSignature(signers, fields).map((s) => s.name)).toEqual(['Luis']);
  });

  it('los campos del PREPARADOR no cuentan para nadie', () => {
    const fields = [
      field({ id: 'p', signerId: PREPARER_PARTY_ID }),
      field({ id: 'a', signerId: 'client:1', type: 'initials' }),
    ];
    expect(signersMissingSignature(signers, fields).map((s) => s.name)).toEqual(['Luis']);
    expect(signerFieldCount(fields)).toBe(1);
  });

  it('todos cubiertos: lista vacía', () => {
    const fields = [
      field({ id: 'a', signerId: 'client:1' }),
      field({ id: 'b', signerId: 'signer-2', type: 'initials' }),
    ];
    expect(signersMissingSignature(signers, fields)).toEqual([]);
  });
});

describe('herramientas del campo (tamaño, alineación, página)', () => {
  const page = { page: 1, width: 600, height: 800 };
  const min = { w: 40, h: 24 };

  it('scaleFieldFromCenter dobla el tamaño conservando el centro', () => {
    const f = field({ id: 'a', x: 200, y: 300, width: 100, height: 40 });
    const doubled = scaleFieldFromCenter(f, 2, min, page);
    expect(doubled.width).toBe(200);
    expect(doubled.height).toBe(80);
    expect(doubled.x + doubled.width / 2).toBe(250);
    expect(doubled.y + doubled.height / 2).toBe(320);
  });

  it('al achicar respeta el mínimo y al agrandar no se sale de la página', () => {
    const f = field({ id: 'a', x: 10, y: 10, width: 50, height: 30 });
    const tiny = scaleFieldFromCenter(f, 0.1, min, page);
    expect(tiny.width).toBe(min.w);
    expect(tiny.height).toBe(min.h);
    const huge = scaleFieldFromCenter(f, 100, min, page);
    expect(huge.width).toBe(page.width);
    expect(huge.height).toBe(page.height);
    expect(huge.x).toBe(0);
    expect(huge.y).toBe(0);
  });

  it('resizeFieldFromCenter lleva al tamaño pedido desde el centro', () => {
    const f = field({ id: 'a', x: 100, y: 100, width: 200, height: 60 });
    const r = resizeFieldFromCenter(f, { w: 120, h: 44 }, min, page);
    expect(r).toMatchObject({ width: 120, height: 44, x: 140, y: 108 });
  });

  it('alignFieldOnPage alinea en un solo eje, con margen y sin salirse', () => {
    const f = field({ id: 'a', x: 200, y: 300, width: 100, height: 40 });
    const mx = page.width * ALIGN_MARGIN_RATIO;
    const my = page.height * ALIGN_MARGIN_RATIO;
    expect(alignFieldOnPage(f, 'left', page)).toMatchObject({ x: mx, y: 300 });
    expect(alignFieldOnPage(f, 'right', page)).toMatchObject({ x: page.width - 100 - mx, y: 300 });
    expect(alignFieldOnPage(f, 'center', page)).toMatchObject({ x: 250, y: 300 });
    expect(alignFieldOnPage(f, 'top', page)).toMatchObject({ x: 200, y: my });
    expect(alignFieldOnPage(f, 'bottom', page)).toMatchObject({ x: 200, y: page.height - 40 - my });
    expect(alignFieldOnPage(f, 'middle', page)).toMatchObject({ x: 200, y: 380 });
  });

  it('projectFieldToPage conserva la posición relativa en una página de otro tamaño', () => {
    const f = field({ id: 'a', page: 1, x: 150, y: 400, width: 300, height: 80 });
    const target = { page: 2, width: 300, height: 400 };
    const moved = projectFieldToPage(f, page, target);
    expect(moved.page).toBe(2);
    expect(moved).toMatchObject({ x: 75, y: 200, width: 150, height: 40 });
  });
});
