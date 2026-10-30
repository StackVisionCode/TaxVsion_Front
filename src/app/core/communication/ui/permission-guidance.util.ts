import type { MediaPermissionState } from '../media/media-devices.service';

export type PermissionDevice = 'microphone' | 'camera';
export type BrowserFamily = 'chromium' | 'firefox' | 'safari' | 'other';

/**
 * F4 — Texto de estado de permisos y guía por navegador (panel Devices y lobby). Puro: recibe el
 * `userAgent` para poder probarlo.
 *
 *   permissionStatusLabel('microphone', 'denied')            // "Microphone blocked in the browser"
 *   permissionGuidance('camera', 'denied', navigator.userAgent) // "Click the lock icon in the address bar…"
 */
export function browserFamily(userAgent: string): BrowserFamily {
  const ua = userAgent.toLowerCase();
  if (ua.includes('firefox')) {
    return 'firefox';
  }
  if (ua.includes('chrome') || ua.includes('chromium') || ua.includes('edg/')) {
    return 'chromium';
  }
  if (ua.includes('safari')) {
    return 'safari';
  }
  return 'other';
}

export function permissionStatusLabel(device: PermissionDevice, state: MediaPermissionState): string {
  const name = device === 'microphone' ? 'Microphone' : 'Camera';
  switch (state) {
    case 'granted':
      return `${name} allowed`;
    case 'denied':
      return `${name} blocked in the browser`;
    case 'unsupported':
      return `${name} not supported in this browser`;
    default:
      return `${name} permission not requested yet`;
  }
}

/** Cómo desbloquearlo; null cuando no hay nada que hacer (concedido / no soportado). */
export function permissionGuidance(device: PermissionDevice, state: MediaPermissionState, userAgent: string): string | null {
  if (state === 'granted') {
    return null;
  }
  const name = device === 'microphone' ? 'microphone' : 'camera';
  if (state === 'unsupported') {
    return `Try a recent version of Chrome, Edge, Firefox or Safari to use your ${name}.`;
  }
  if (state === 'prompt') {
    return `Your browser will ask for ${name} access when you join.`;
  }
  switch (browserFamily(userAgent)) {
    case 'firefox':
      return `Click the permissions icon to the left of the address bar, remove the ${name} block and reload.`;
    case 'safari':
      return `Open the Safari menu → Settings for this website → ${name === 'microphone' ? 'Microphone' : 'Camera'} → Allow, then reload.`;
    case 'chromium':
      return `Click the lock icon in the address bar → Site settings → ${name === 'microphone' ? 'Microphone' : 'Camera'} → Allow, then reload.`;
    default:
      return `Allow ${name} access in your browser's site settings and reload.`;
  }
}

/** Etiqueta de un dispositivo sin `label` (antes del primer permiso): "Default microphone", "Camera 2"… */
export function deviceLabel(device: Pick<MediaDeviceInfo, 'label' | 'deviceId' | 'kind'>, index: number): string {
  if (device.label) {
    return device.label;
  }
  const name = device.kind === 'audioinput' ? 'microphone' : device.kind === 'videoinput' ? 'camera' : 'speaker';
  if (index === 0 || device.deviceId === 'default') {
    return `Default ${name}`;
  }
  return `${name[0].toUpperCase()}${name.slice(1)} ${index + 1}`;
}
