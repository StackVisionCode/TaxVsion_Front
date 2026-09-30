import { formatBytes, formatMoney, formatRelativeTime } from './format.util';
import { formatBytes as coreFormatBytes } from '@core/cloud-storage/cloud-storage.model';

describe('format.util', () => {
  describe('formatBytes', () => {
    it('mantiene la salida original B/KB/MB', () => {
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1536)).toBe('2 KB');
      expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
      expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5120.0 MB');
    });

    it('maxUnit permite GB', () => {
      expect(formatBytes(5 * 1024 * 1024 * 1024, { maxUnit: 'GB' })).toBe('5.0 GB');
      expect(formatBytes(2048, { maxUnit: 'B' })).toBe('2048 B');
    });

    it('el export de core delega aquí', () => {
      expect(coreFormatBytes(1536)).toBe('2 KB');
    });
  });

  describe('formatMoney', () => {
    it('formatea con 2 decimales en USD por defecto', () => {
      expect(formatMoney(1234.5)).toBe('$1,234.50');
    });

    it('fromCents y minFraction', () => {
      expect(formatMoney(123456, 'USD', { fromCents: true })).toBe('$1,234.56');
      expect(formatMoney(1200, 'USD', { minFraction: 0 })).toBe('$1,200');
      expect(formatMoney(null)).toBe('$0.00');
    });

    it('moneda inválida cae a USD', () => {
      expect(formatMoney(1, 'NOPE!')).toBe('$1.00');
    });
  });

  describe('formatRelativeTime', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');

    it('rangos', () => {
      expect(formatRelativeTime('2026-09-30T11:59:40Z', now)).toBe('Just now');
      expect(formatRelativeTime('2026-09-30T11:40:00Z', now)).toBe('20m ago');
      expect(formatRelativeTime('2026-09-30T09:00:00Z', now)).toBe('3h ago');
      expect(formatRelativeTime('2026-09-29T10:00:00Z', now)).toBe('Yesterday');
      expect(formatRelativeTime('2026-09-27T10:00:00Z', now)).toBe('3 days ago');
    });

    it('interpreta como UTC un ISO sin zona', () => {
      expect(formatRelativeTime('2026-09-30T11:40:00', now)).toBe('20m ago');
    });

    it('inválido o vacío → cadena vacía', () => {
      expect(formatRelativeTime('nope', now)).toBe('');
      expect(formatRelativeTime(null, now)).toBe('');
    });
  });
});
