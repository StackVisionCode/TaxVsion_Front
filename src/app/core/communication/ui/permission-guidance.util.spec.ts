import { describe, expect, it } from 'vitest';
import { browserFamily, deviceLabel, permissionGuidance, permissionStatusLabel } from './permission-guidance.util';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('permission-guidance.util', () => {
  it('detecta la familia del navegador (Chrome lleva "Safari" en el UA)', () => {
    expect(browserFamily(CHROME)).toBe('chromium');
    expect(browserFamily(FIREFOX)).toBe('firefox');
    expect(browserFamily(SAFARI)).toBe('safari');
    expect(browserFamily('curl/8')).toBe('other');
  });

  it('etiqueta el estado sin decir nunca "Unknown"', () => {
    expect(permissionStatusLabel('microphone', 'granted')).toBe('Microphone allowed');
    expect(permissionStatusLabel('camera', 'denied')).toBe('Camera blocked in the browser');
    expect(permissionStatusLabel('camera', 'prompt')).toBe('Camera permission not requested yet');
    expect(permissionStatusLabel('microphone', 'unsupported')).toBe('Microphone not supported in this browser');
  });

  it('la guía de un bloqueo depende del navegador; concedido no tiene guía', () => {
    expect(permissionGuidance('microphone', 'granted', CHROME)).toBeNull();
    expect(permissionGuidance('microphone', 'denied', CHROME)).toContain('lock icon');
    expect(permissionGuidance('camera', 'denied', FIREFOX)).toContain('permissions icon');
    expect(permissionGuidance('camera', 'denied', SAFARI)).toContain('Settings for this website');
    expect(permissionGuidance('camera', 'prompt', CHROME)).toContain('will ask');
  });

  it('pone "Default microphone" cuando el navegador aún no da labels', () => {
    expect(deviceLabel({ label: '', deviceId: 'default', kind: 'audioinput' }, 0)).toBe('Default microphone');
    expect(deviceLabel({ label: '', deviceId: 'abc', kind: 'videoinput' }, 1)).toBe('Camera 2');
    expect(deviceLabel({ label: 'USB Mic', deviceId: 'abc', kind: 'audioinput' }, 3)).toBe('USB Mic');
  });
});
