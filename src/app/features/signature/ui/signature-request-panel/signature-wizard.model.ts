/** Tipos del wizard de "New Signature Request" (cliente → documento → editor de campos PDF). */

export type FieldType = 'signature' | 'initials' | 'date' | 'text';

/**
 * Campo colocado sobre una página del PDF. `x/y/width/height` están en px de
 * pantalla relativos al canvas de esa página (origen arriba-izquierda). Al
 * enviar se convierten a puntos PDF con `screenRectToPdf`.
 */
export interface PlacedField {
  id: string;
  type: FieldType;
  /** Página 1-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** id del firmante dueño del campo. */
  signerId: string;
}

/** Canal por el que el firmante recibe/verifica su código (propuesta UX). */
export type VerificationChannel = 'email' | 'sms' | 'whatsapp' | 'app';

/** Reglas de la solicitud (panel Rules del editor, tomadas de la propuesta UX). */
export interface RequestRules {
  /** true = los firmantes firman en orden; false = cualquiera primero. */
  sequential: boolean;
  /** Canales de verificación habilitados (mínimo 1); el firmante elige entre ellos. */
  channels: VerificationChannel[];
  autoReminder: boolean;
  certificate: boolean;
  includePreparerSignature: boolean;
}

/** Firmante dentro del editor (el cliente es el firmante #1; se pueden añadir más). */
export interface EditorSigner {
  id: string;
  name: string;
  email: string;
  /** Clase Tailwind de fondo del avatar (bg-*). */
  color: string;
  /** Canal preferido para verificar su identidad. */
  channel: VerificationChannel;
}

/** Cliente elegido en el paso 1 (subset mock, alineado con ClientItem de la feature clients). */
export interface WizardClient {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  type: 'individual' | 'company';
  isActive: boolean;
  /** Fecha de alta (YYYY-MM-DD). */
  createdAt: string;
}

export type WizardDocKind = 'pdf' | 'doc' | 'img' | 'xlsx';

/** Documento elegido o subido en el paso 2. */
export interface WizardDocument {
  id: string;
  name: string;
  kind: WizardDocKind;
  size: string;
  /** Última modificación, en texto listo para mostrar (p. ej. "Jun 28, 2026"). */
  date: string;
  /** Bytes reales cuando se sube un PDF; null para documentos mock (renderizan el PDF de muestra). */
  blob: Blob | null;
}
