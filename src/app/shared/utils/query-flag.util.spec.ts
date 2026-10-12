import { describe, expect, it, vi } from 'vitest';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { consumeQueryFlag } from './query-flag.util';

function setup(params: Record<string, string>) {
  const route = { snapshot: { queryParamMap: convertToParamMap(params) } } as unknown as ActivatedRoute;
  const navigate = vi.fn().mockResolvedValue(true);
  const router = { navigate } as unknown as Router;
  return { route, router, navigate };
}

describe('consumeQueryFlag', () => {
  it('devuelve true y quita solo esa clave con replaceUrl', () => {
    const { route, router, navigate } = setup({ new: '1', term: 'ana' });

    expect(consumeQueryFlag(route, router, 'new')).toBe(true);
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { new: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('sin el flag (o con otro valor) no navega', () => {
    const absent = setup({ term: 'ana' });
    expect(consumeQueryFlag(absent.route, absent.router, 'new')).toBe(false);
    expect(absent.navigate).not.toHaveBeenCalled();

    const other = setup({ new: 'true' });
    expect(consumeQueryFlag(other.route, other.router, 'new')).toBe(false);
    expect(other.navigate).not.toHaveBeenCalled();
  });
});
