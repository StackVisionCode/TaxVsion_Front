import { Pipe, PipeTransform } from '@angular/core';
import { formatRelativeTime } from '../utils/format.util';

/**
 * `{{ n.createdAtUtc | timeAgo }}` → "20m ago" / "Yesterday" / fecha.
 *
 * Pipe PURO: solo se recalcula cuando cambia el valor, no con el paso del tiempo. Si una vista necesita
 * que "Just now" avance solo, que pase un `now` que cambie (p. ej. un signal de reloj):
 * `{{ iso | timeAgo: clock() }}`.
 */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null | undefined, now?: number | Date): string {
    return formatRelativeTime(value, now ?? Date.now());
  }
}
