/**
 * F4 (T-59) — Errores de captura tipados. `getUserMedia`/`getDisplayMedia` lanzan DOMException con
 * nombres distintos por navegador; acá se normalizan a un `kind` cerrado con copy en inglés listo para
 * la UI y una guía corta cuando el usuario puede resolverlo solo.
 */
export type MediaDeviceKind = 'microphone' | 'camera' | 'screen';

export type MediaAccessErrorKind =
  | 'NotAllowed'
  | 'NotFound'
  | 'NotReadable'
  | 'Overconstrained'
  | 'Cancelled'
  | 'Unsupported'
  | 'Unknown';

export class MediaAccessError extends Error {
  constructor(
    readonly kind: MediaAccessErrorKind,
    readonly device: MediaDeviceKind,
    message: string,
    /** Cómo resolverlo (p. ej. dónde desbloquear el permiso); null si no hay nada que hacer. */
    readonly guidance: string | null = null,
  ) {
    super(message);
    this.name = 'MediaAccessError';
  }
}

const DEVICE_LABEL: Record<MediaDeviceKind, string> = { microphone: 'microphone', camera: 'camera', screen: 'screen' };

/** Traduce el DOMException del navegador a un `MediaAccessError` con copy de usuario. */
export function toMediaAccessError(err: unknown, device: MediaDeviceKind): MediaAccessError {
  if (err instanceof MediaAccessError) {
    return err;
  }
  const name = (err as { name?: string } | null)?.name ?? '';
  const label = DEVICE_LABEL[device];
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      if (device === 'screen') {
        // El selector de pantalla cancelado llega como NotAllowed: no es un bloqueo.
        return new MediaAccessError('Cancelled', device, 'Screen sharing was cancelled.');
      }
      return new MediaAccessError(
        'NotAllowed',
        device,
        `The ${label} is blocked in the browser.`,
        `Allow ${label} access in the site settings (lock icon in the address bar) and try again.`,
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new MediaAccessError('NotFound', device, `No ${label} was found.`, `Connect a ${label} and try again.`);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new MediaAccessError(
        'NotReadable',
        device,
        `The ${label} is in use by another app.`,
        `Close other apps using the ${label} and try again.`,
      );
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new MediaAccessError('Overconstrained', device, `The selected ${label} is unavailable.`);
    case 'TypeError':
      return new MediaAccessError('Unsupported', device, `This browser cannot access the ${label}.`);
    default:
      return new MediaAccessError('Unknown', device, `Could not access the ${label}.`);
  }
}
