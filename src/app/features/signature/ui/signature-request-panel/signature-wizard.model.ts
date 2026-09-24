/** Tipos del wizard de "New Signature Request" (cliente → documento → editor de campos PDF). */
import { SetPreparerBody, SignerLanguage } from '../../data-access/signature.model';

export type FieldType = 'signature' | 'initials' | 'date' | 'text';

/**
 * "Firmante" sintético para los campos del preparador dentro del editor: viven en el mismo array de
 * campos con este `signerId`, y se separan al exportar (buildPreparerFields) porque el preparador no es
 * un firmante (no recibe email/token). El backend los recibe por endpoints propios (preparer-fields).
 */
export const PREPARER_PARTY_ID = 'preparer';

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
  /** Instrucción/etiqueta que verá el firmante (solo campos `text`). */
  label?: string;
}

/** Canal por el que el firmante recibe/verifica su código (propuesta UX). */
// 'none' = sin código OTP (el firmante no recibe código): útil cuando la seguridad la da el
// Practitioner PIN por sí solo, o el documento no requiere verificación extra.
export type VerificationChannel = 'email' | 'sms' | 'whatsapp' | 'app' | 'none';

/** Reglas de la solicitud (panel Rules del editor, tomadas de la propuesta UX). */
export interface RequestRules {
  /** true = los firmantes firman en orden; false = cualquiera primero. */
  sequential: boolean;
  /** Canales de verificación habilitados (mínimo 1); el firmante elige entre ellos. */
  channels: VerificationChannel[];
  autoReminder: boolean;
  /** Cada cuántas HORAS se recuerda a los firmantes pendientes (la UI lo edita en días). */
  reminderIntervalHours: number;
  certificate: boolean;
  /** P2: entregar el documento firmado a los firmantes al completar (email/SMS). */
  sendSignedDocument: boolean;
  /** P2: entregar el certificado de finalización a los firmantes al completar. */
  sendCertificate: boolean;
  /**
   * PIN del preparador (Practitioner PIN, Form 8879): secreto de 4–10 dígitos que el preparador fija y
   * comunica al cliente por fuera; el cliente lo escribe en la página de firma. Opcional (null = sin PIN).
   * Es una capa aparte del OTP, no lo reemplaza.
   */
  signingPin: string | null;
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
  /** Teléfono para OTP por SMS/WhatsApp (E.164). Vacío si no aplica. */
  phone: string;
  /** Idioma de los correos al firmante ('Es' | 'En'). Default 'En'. */
  language: SignerLanguage;
}

/** Campo sembrado al rehidratar un borrador: coordenadas NORMALIZADas [0..1] (el editor las pasa a px al render). */
export interface EditorSeedField {
  localId: string;
  type: FieldType;
  /** Página 1-based. */
  page: number;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  signerLocalId: string;
  label?: string;
}

/** Estado con el que se siembra el editor al "continuar" un borrador existente. */
export interface EditorSeed {
  signers: EditorSigner[];
  fields: EditorSeedField[];
  rules: RequestRules;
  /** FileId de la firma del preparador elegida en el borrador (para preseleccionarla en el editor). */
  preparerSignatureFileId?: string | null;
  /** Identidad 8879 del preparador (PTIN/nombre/título) capturada inline en el wizard. */
  preparerInfo?: SetPreparerBody | null;
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
  /** fileId de CloudStorage tras el preflight + upload (requisito para crear la solicitud real). */
  fileId?: string | null;
  /** Páginas reportadas por el preflight de /signature/documents/validate. */
  pageCount?: number | null;
}
