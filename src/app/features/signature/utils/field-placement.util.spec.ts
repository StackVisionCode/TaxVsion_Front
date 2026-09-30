import {
  decodeFieldDrag,
  dropPosition,
  encodeFieldDrag,
  PageBox,
  visiblePlacement,
} from './field-placement.util';

const size = { w: 100, h: 40 };

function page(n: number, top: number, extra: Partial<PageBox> = {}): PageBox {
  return { page: n, left: 50, top, width: 600, height: 800, ...extra };
}

describe('field-placement util', () => {
  describe('dropPosition', () => {
    it('centra el campo bajo el puntero (coords relativas a la página)', () => {
      expect(dropPosition(350, 500, page(1, 100), size)).toEqual({ x: 250, y: 380 });
    });

    it('no deja que el campo se salga por ningún borde', () => {
      expect(dropPosition(0, 0, page(1, 100), size)).toEqual({ x: 0, y: 0 });
      expect(dropPosition(5000, 5000, page(1, 100), size)).toEqual({ x: 500, y: 760 });
    });

    it('en una página más chica que el campo lo ancla a 0', () => {
      expect(dropPosition(60, 60, page(1, 0, { width: 50, height: 20 }), size)).toEqual({ x: 0, y: 0 });
    });
  });

  describe('visiblePlacement', () => {
    const viewport = { left: 0, top: 0, width: 800, height: 600 };

    it('elige la página con más área visible, no siempre la 1', () => {
      // pág 1 casi fuera por arriba (visible 0..100), pág 2 ocupa el resto del visor (110..600)
      const pages = [page(1, -700), page(2, 110)];
      expect(visiblePlacement(pages, viewport, size)?.page).toBe(2);
    });

    it('centra en la porción visible de la página', () => {
      const pages = [page(1, 0)];
      // visible y: 0..600 → centro 300; x: 50..650 → centro 350 → relativo 300
      expect(visiblePlacement(pages, viewport, size)).toEqual({ page: 1, x: 250, y: 280 });
    });

    it('respeta el scroll: si la página empezó arriba del visor, centra en lo que se ve', () => {
      const pages = [page(1, -400)];
      // visible y de página: 400..800 (pantalla 0..400) → centro relativo 600
      expect(visiblePlacement(pages, viewport, size)).toEqual({ page: 1, x: 250, y: 580 });
    });

    it('devuelve null si ninguna página está a la vista', () => {
      expect(visiblePlacement([page(1, 2000)], viewport, size)).toBeNull();
    });
  });

  describe('encode/decode del drag', () => {
    const allowed = ['signature', 'initials', 'date', 'text'] as const;

    it('ida y vuelta', () => {
      const raw = encodeFieldDrag({ kind: 'preparer', type: 'date' });
      expect(decodeFieldDrag(raw, allowed)).toEqual({ kind: 'preparer', type: 'date' });
    });

    it('rechaza payloads ajenos, tipos no permitidos o JSON roto', () => {
      expect(decodeFieldDrag('', allowed)).toBeNull();
      expect(decodeFieldDrag('not json', allowed)).toBeNull();
      expect(decodeFieldDrag(JSON.stringify({ kind: 'signer', type: 'checkbox' }), allowed)).toBeNull();
      expect(decodeFieldDrag(JSON.stringify({ kind: 'other', type: 'text' }), allowed)).toBeNull();
    });
  });
});
