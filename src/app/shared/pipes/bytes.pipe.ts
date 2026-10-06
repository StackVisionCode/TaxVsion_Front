import { Pipe, PipeTransform } from '@angular/core';
import { ByteUnit, formatBytes } from '../utils/format.util';

/**
 * `{{ file.sizeBytes | bytes }}` → "12 KB" · `{{ quota | bytes: 'GB' }}` → "5.0 GB".
 * Envuelve `formatBytes` (shared/utils/format.util); null/undefined → ''.
 */
@Pipe({ name: 'bytes' })
export class BytesPipe implements PipeTransform {
  transform(value: number | null | undefined, maxUnit?: ByteUnit): string {
    if (value === null || value === undefined) {
      return '';
    }
    return formatBytes(value, { maxUnit });
  }
}
