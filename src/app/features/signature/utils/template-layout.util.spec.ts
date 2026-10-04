import { FieldType } from '../ui/signature-request-panel/signature-wizard.model';
import {
  PREPARER_SLOT,
  TemplateFieldLocal,
  buildNormalizedPreparerFields,
  buildNormalizedSignerFields,
  copyFieldToAllPages,
  duplicateField,
  maxLocalSeq,
  moveFieldToPage,
  nudgeField,
  preserveLocalLayout,
  remapFieldsToPages,
  rolesMissingSignature,
} from './template-layout.util';

// ---------------------------------------------------------------------------
// Referencia: la implementación ANTERIOR del editor de plantillas (copiada tal cual de
// signature-template-editor.component.ts antes de pasar a normalizeFieldRect). La nueva debe
// producir exactamente la misma salida.
// ---------------------------------------------------------------------------
type OldPage = { page: number; width: number; height: number };

function oldBuildNormalizedFields(fields: TemplateFieldLocal[], pages: OldPage[]) {
  const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
  const round = (v: number): number => Math.round(v * 10000) / 10000;
  const out: { slotOrder: number; type: FieldType; page: number; x: number; y: number; width: number; height: number; label?: string }[] = [];
  for (const field of fields) {
    if (field.slotOrder === PREPARER_SLOT) {
      continue;
    }
    const page = pages.find(p => p.page === field.page);
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
      slotOrder: field.slotOrder,
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

function oldBuildNormalizedPreparerFields(fields: TemplateFieldLocal[], pages: OldPage[]) {
  const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
  const round = (v: number): number => Math.round(v * 10000) / 10000;
  const out: { type: FieldType; page: number; x: number; y: number; width: number; height: number }[] = [];
  for (const field of fields) {
    if (field.slotOrder !== PREPARER_SLOT) {
      continue;
    }
    const page = pages.find(p => p.page === field.page);
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
    if (width > 0 && height > 0) {
      out.push({ type: field.type, page: field.page, x, y, width, height });
    }
  }
  return out;
}

function field(partial: Partial<TemplateFieldLocal> & Pick<TemplateFieldLocal, 'localId'>): TemplateFieldLocal {
  return { slotOrder: 1, type: 'signature', page: 1, x: 100, y: 200, width: 240, height: 72, ...partial };
}

const PAGES = [
  { page: 1, width: 734.4, height: 950.4 },
  { page: 2, width: 734.4, height: 950.4 },
  { page: 3, width: 612, height: 1008 },
];

/** Muestra variada: bordes, fuera de página, sin área, página inexistente, texto con/sin etiqueta. */
const SAMPLE: TemplateFieldLocal[] = [
  field({ localId: 'a' }),
  field({ localId: 'b', type: 'initials', x: 700, y: 900, width: 90, height: 60 }),
  field({ localId: 'c', type: 'text', label: '  Spouse SSN  ', x: 0, y: 0, width: 170, height: 40 }),
  field({ localId: 'd', type: 'text', label: '   ', page: 2, x: 33.3333, y: 777.7777, width: 99.99, height: 41.41 }),
  field({ localId: 'e', type: 'date', page: 3, x: -20, y: -5, width: 130, height: 40 }),
  field({ localId: 'f', page: 9 }),
  field({ localId: 'g', x: 734.4, y: 10, width: 50, height: 10 }),
  field({ localId: 'h', slotOrder: 2, type: 'signature', page: 2, x: 512.17, y: 640.003, width: 200.5, height: 60.25 }),
  field({ localId: 'p1', slotOrder: PREPARER_SLOT, type: 'signature', x: 300, y: 880, width: 240, height: 72 }),
  field({ localId: 'p2', slotOrder: PREPARER_SLOT, type: 'date', page: 3, x: 590, y: 990, width: 156, height: 48 }),
];

describe('template-layout.util', () => {
  describe('paridad de la normalización con la implementación anterior', () => {
    it('campos de firmante: misma salida exacta', () => {
      expect(buildNormalizedSignerFields(SAMPLE, PAGES)).toEqual(oldBuildNormalizedFields(SAMPLE, PAGES));
    });

    it('campos del preparador: misma salida exacta', () => {
      expect(buildNormalizedPreparerFields(SAMPLE, PAGES)).toEqual(oldBuildNormalizedPreparerFields(SAMPLE, PAGES));
    });

    it('a zoom 0.6 / 1 / 2 la salida es la misma', () => {
      const at = (z: number) => {
        const fields = SAMPLE.map(f => ({ ...f, x: f.x * z, y: f.y * z, width: f.width * z, height: f.height * z }));
        const pages = PAGES.map(p => ({ ...p, width: p.width * z, height: p.height * z }));
        return buildNormalizedSignerFields(fields, pages);
      };
      expect(at(0.6)).toEqual(at(1));
      expect(at(2)).toEqual(at(1));
    });

    it('excluye a los del preparador del payload de firmantes y viceversa', () => {
      expect(buildNormalizedSignerFields(SAMPLE, PAGES).some(f => f.slotOrder === PREPARER_SLOT)).toBe(false);
      expect(buildNormalizedPreparerFields(SAMPLE, PAGES)).toHaveLength(2);
    });
  });

  describe('rolesMissingSignature (validación de publicación)', () => {
    const slots = [
      { order: 2, role: 'Spouse' },
      { order: 1, role: 'Client' },
    ];

    it('lista, en orden, los roles sin firma ni iniciales', () => {
      expect(rolesMissingSignature(slots, [])).toEqual(['Client', 'Spouse']);
      expect(rolesMissingSignature(slots, [{ slotOrder: 1, type: 'signature' }])).toEqual(['Spouse']);
      expect(
        rolesMissingSignature(slots, [
          { slotOrder: 1, type: 'signature' },
          { slotOrder: 2, type: 'initials' },
        ]),
      ).toEqual([]);
    });

    it('fecha y texto no cuentan como firma', () => {
      expect(
        rolesMissingSignature(slots, [
          { slotOrder: 1, type: 'date' },
          { slotOrder: 2, type: 'text' },
        ]),
      ).toEqual(['Client', 'Spouse']);
    });

    it('la firma del preparador NO cuenta para ningún rol', () => {
      expect(rolesMissingSignature(slots, [{ slotOrder: PREPARER_SLOT, type: 'signature' }])).toEqual([
        'Client',
        'Spouse',
      ]);
    });
  });

  describe('duplicar y copiar a todas las páginas', () => {
    it('duplicar desplaza la copia dentro de la página y le da un id nuevo', () => {
      const src = field({ localId: 'a', x: 100, y: 200 });
      const copy = duplicateField(src, PAGES[0], 'f-9');
      expect(copy).toEqual({ ...src, localId: 'f-9', x: 116, y: 216 });
    });

    it('duplicar en el borde no se sale de la página', () => {
      const src = field({ localId: 'a', x: 734.4 - 240, y: 950.4 - 72 });
      const copy = duplicateField(src, PAGES[0], 'f-1');
      expect(copy.x + copy.width).toBeLessThanOrEqual(734.4);
      expect(copy.y + copy.height).toBeLessThanOrEqual(950.4);
    });

    it('copiar a todas las páginas crea un campo por cada otra página, en la misma posición relativa', () => {
      let n = 0;
      const src = field({ localId: 'a', type: 'initials', slotOrder: 2, x: 73.44, y: 95.04, width: 73.44, height: 47.52 });
      const copies = copyFieldToAllPages(src, PAGES, () => `f-${n++}`);
      expect(copies.map(c => c.page)).toEqual([2, 3]);
      expect(copies.map(c => c.localId)).toEqual(['f-0', 'f-1']);
      expect(copies.every(c => c.slotOrder === 2 && c.type === 'initials')).toBe(true);
      // Página 3 tiene otro tamaño: la posición relativa se conserva (10 % / 10 %).
      expect(copies[1].x).toBeCloseTo(61.2, 6);
      expect(copies[1].y).toBeCloseTo(100.8, 6);
      // El payload normalizado de las copias coincide con el del original.
      const norm = buildNormalizedSignerFields([src, ...copies], PAGES);
      expect(new Set(norm.map(f => `${f.x}|${f.y}|${f.width}|${f.height}`)).size).toBe(1);
    });

    it('con una sola página no crea copias', () => {
      expect(copyFieldToAllPages(field({ localId: 'a' }), [PAGES[0]], () => 'x')).toEqual([]);
    });
  });

  describe('mover', () => {
    it('nudge respeta los bordes de la página', () => {
      const f = field({ localId: 'a', x: 2, y: 2 });
      expect(nudgeField(f, -10, -10, PAGES[0])).toMatchObject({ x: 0, y: 0 });
      expect(nudgeField(f, 1, 10, PAGES[0])).toMatchObject({ x: 3, y: 12 });
    });

    it('cambiar de página conserva la posición relativa', () => {
      const f = field({ localId: 'a', x: 367.2, y: 475.2, width: 73.44, height: 95.04 });
      const moved = moveFieldToPage(f, PAGES[0], PAGES[2]);
      expect(moved.page).toBe(3);
      expect(moved.x).toBeCloseTo(306, 6);
      expect(moved.y).toBeCloseTo(504, 6);
    });
  });

  describe('remapFieldsToPages', () => {
    it('al cambiar de zoom re-escala sin cambiar el payload normalizado', () => {
      const fields = SAMPLE.filter(f => f.page <= 3);
      const next = PAGES.map(p => ({ ...p, width: p.width * 2, height: p.height * 2 }));
      const { fields: scaled, moved } = remapFieldsToPages(fields, PAGES, next);
      expect(moved).toBe(0);
      expect(buildNormalizedSignerFields(scaled, next)).toEqual(buildNormalizedSignerFields(fields, PAGES));
    });

    it('cuenta los campos que pasan a la página 1 porque el documento nuevo no tiene su página', () => {
      const fields = [field({ localId: 'a', page: 1 }), field({ localId: 'b', page: 3 })];
      const { fields: out, moved } = remapFieldsToPages(fields, PAGES, [PAGES[0]]);
      expect(moved).toBe(1);
      expect(out.map(f => f.page)).toEqual([1, 1]);
    });
  });

  describe('preserveLocalLayout', () => {
    const oldSlots = [
      { id: 's-client', order: 1 },
      { id: 's-spouse', order: 2 },
      { id: 's-third', order: 3 },
    ];

    it('sin cambios de slots devuelve el mismo layout', () => {
      const local = SAMPLE.slice(0, 3);
      expect(preserveLocalLayout(local, oldSlots, oldSlots)).toEqual(local);
    });

    it('traduce por slot.id si el backend renumeró y descarta los del rol quitado; el preparador se conserva', () => {
      const local = [
        field({ localId: 'c1', slotOrder: 1 }),
        field({ localId: 's2', slotOrder: 2 }),
        field({ localId: 't3', slotOrder: 3 }),
        field({ localId: 'p', slotOrder: PREPARER_SLOT }),
      ];
      // Se quitó Spouse (order 2): Third pasa a order 2.
      const newSlots = [
        { id: 's-client', order: 1 },
        { id: 's-third', order: 2 },
      ];
      const out = preserveLocalLayout(local, oldSlots, newSlots);
      expect(out.map(f => [f.localId, f.slotOrder])).toEqual([
        ['c1', 1],
        ['t3', 2],
        ['p', PREPARER_SLOT],
      ]);
    });
  });

  it('maxLocalSeq solo mira ids f-N', () => {
    expect(maxLocalSeq([{ localId: 'srv-1' }, { localId: 'f-3' }, { localId: 'f-12' }])).toBe(12);
    expect(maxLocalSeq([{ localId: 'srv-abc' }])).toBe(-1);
  });
});
