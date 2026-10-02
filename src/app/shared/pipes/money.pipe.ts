import { Pipe, PipeTransform } from '@angular/core';
import { FormatMoneyOptions, formatMoney } from '../utils/format.util';

/**
 * `{{ invoice.totalCents | money: invoice.currency : { fromCents: true } }}` → "$1,234.56".
 * Envuelve `formatMoney` (shared/utils/format.util); null/undefined → ''.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency: string | null = 'USD', options: FormatMoneyOptions = {}): string {
    if (value === null || value === undefined) {
      return '';
    }
    return formatMoney(value, currency, options);
  }
}
