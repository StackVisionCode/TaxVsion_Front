import {
  EditorSigner,
  PREPARER_PARTY_ID,
  PlacedField,
} from '../ui/signature-request-panel/signature-wizard.model';
import {
  DUPLICATE_OFFSET,
  clampToPage,
  copyFieldToAllPages,
  duplicateFieldRect,
  nudgeField,
  reassignSignerFields,
  remapFieldsToPages,
  rescaleFields,
  rescaleFieldsBetweenPages,
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
