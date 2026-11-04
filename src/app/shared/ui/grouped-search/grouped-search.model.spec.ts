import { describe, expect, it } from 'vitest';
import {
  flattenEntries,
  highlightParts,
  moveHighlight,
  visibleGroups,
} from './grouped-search.model';

const item = (id: string) => ({ id, label: id, data: id });

describe('grouped-search: funciones puras', () => {
  it('recorta cada grupo y quita los vacíos', () => {
    const groups = visibleGroups(
      [
        { id: 'a', label: 'A', items: [item('1'), item('2'), item('3')] },
        { id: 'b', label: 'B', items: [] },
      ],
      2,
    );
    expect(groups.map((group) => [group.id, group.items.length])).toEqual([['a', 2]]);
  });

  it('aplana en orden de pintado y agrega el pie "See all" al final', () => {
    const entries = flattenEntries(
      [
        { id: 'clients', label: 'Clients', items: [item('c1')] },
        { id: 'emails', label: 'Emails', items: [item('e1'), item('e2')] },
      ],
      true,
    );
    expect(
      entries.map((entry) => (entry.kind === 'item' ? `${entry.groupId}:${entry.item.id}` : 'all')),
    ).toEqual(['clients:c1', 'emails:e1', 'emails:e2', 'all']);
  });

  it('las flechas son cíclicas y arrancan sin nada resaltado (Enter busca lo tecleado)', () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0);
    expect(moveHighlight(-1, -1, 3)).toBe(2);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(0, 1, 0)).toBe(-1);
  });

  it('marca cada coincidencia sin distinguir mayúsculas y conserva el texto original', () => {
    expect(highlightParts('Factura 2026 — factura final', 'FACT')).toEqual([
      { text: 'Fact', match: true },
      { text: 'ura 2026 — ', match: false },
      { text: 'fact', match: true },
      { text: 'ura final', match: false },
    ]);
    expect(highlightParts('W-2', '')).toEqual([{ text: 'W-2', match: false }]);
    expect(highlightParts(null, 'x')).toEqual([]);
  });
});
