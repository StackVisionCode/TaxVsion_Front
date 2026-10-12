import { ActivatedRoute, Router } from '@angular/router';

/**
 * Consume un flag de un solo uso en la URL (`?new=1`, `?schedule=1`…): devuelve true si estaba en `'1'`
 * y lo quita de la URL con `replaceUrl`, para que recargar o volver atrás no reabra el panel.
 *
 * `queryParamsHandling: 'merge'` + `null` quita SOLO esa clave y conserva el resto (algunas páginas
 * sincronizan sus filtros en la URL y harían sobrevivir el flag si se reemplazara todo).
 */
export function consumeQueryFlag(route: ActivatedRoute, router: Router, key: string): boolean {
  if (route.snapshot.queryParamMap.get(key) !== '1') {
    return false;
  }
  void router.navigate([], {
    relativeTo: route,
    queryParams: { [key]: null },
    queryParamsHandling: 'merge',
    replaceUrl: true,
  });
  return true;
}
