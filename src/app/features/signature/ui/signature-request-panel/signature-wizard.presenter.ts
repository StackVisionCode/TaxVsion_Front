import {
  FieldType,
  RequestRules,
  VerificationChannel,
  WizardClient,
  WizardDocKind,
} from './signature-wizard.model';

/**
 * Helpers de presentación del wizard de firma (colores, iconos, labels, formatos).
 * Antes vivían en signature-wizard.mock.ts junto a los seeds; al integrar el
 * backend real los seeds murieron y los helpers se quedaron acá.
 */

const AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

export function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Badge de tipo de cliente (misma paleta que client-table). */
export function clientTypeBadge(type: WizardClient['type']): string {
  return type === 'company' ? 'border-indigo-50 text-orange-600' : 'border-indigo-100 text-indigo-600';
}

const KIND_BY_EXTENSION: Record<string, WizardDocKind> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  png: 'img',
  jpg: 'img',
  jpeg: 'img',
  xls: 'xlsx',
  xlsx: 'xlsx',
};

export function kindFromName(name: string): WizardDocKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return KIND_BY_EXTENSION[ext] ?? 'doc';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Icono ionicons por tipo de documento. */
export function kindIcon(kind: WizardDocKind): string {
  switch (kind) {
    case 'pdf':
      return 'document-text-outline';
    case 'img':
      return 'image-outline';
    case 'xlsx':
      return 'stats-chart-outline';
    case 'doc':
      return 'document-outline';
  }
}

/** Círculo pastel por tipo de documento (misma paleta que file-browser). */
export function kindCircle(kind: WizardDocKind): string {
  switch (kind) {
    case 'pdf':
      return 'bg-indigo-50';
    case 'xlsx':
      return 'bg-indigo-100';
    case 'img':
      return 'bg-gray-200';
    case 'doc':
      return 'bg-indigo-100';
  }
}

/** Metadata de los canales de verificación (label + ionicon). */
export const CHANNEL_META: Record<VerificationChannel, { label: string; icon: string }> = {
  email: { label: 'Email', icon: 'mail-outline' },
  sms: { label: 'SMS', icon: 'chatbox-outline' },
  whatsapp: { label: 'WhatsApp', icon: 'logo-whatsapp' },
  app: { label: 'Auth app', icon: 'phone-portrait-outline' },
};

export const ALL_CHANNELS: VerificationChannel[] = ['email', 'sms', 'whatsapp', 'app'];

/** Reglas por defecto de una solicitud nueva (como en la propuesta UX). */
export function defaultRules(): RequestRules {
  return {
    sequential: true,
    channels: ['email', 'sms'],
    autoReminder: true,
    certificate: true,
    includePreparerSignature: false,
  };
}

/** Presentación de los tipos de campo (compartida por el editor y el paso Review). */
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date',
  text: 'Text',
};

export const FIELD_TYPE_ICON: Record<FieldType, string> = {
  signature: 'create-outline',
  initials: 'text-outline',
  date: 'calendar-outline',
  text: 'reader-outline',
};

/** Círculo pastel por tipo de campo (paleta de acentos de la casa). */
export const FIELD_TYPE_CIRCLE: Record<FieldType, string> = {
  signature: 'bg-indigo-50',
  initials: 'bg-indigo-100',
  date: 'bg-indigo-100',
  text: 'bg-gray-200',
};

/** Chip uppercase del tipo de documento (misma paleta que file-browser). */
export function kindChip(kind: WizardDocKind): string {
  switch (kind) {
    case 'pdf':
      return 'border-orange-200 text-orange-500';
    case 'xlsx':
      return 'border-emerald-200 text-emerald-600';
    case 'img':
      return 'border-gray-300 text-gray-500';
    case 'doc':
      return 'border-indigo-200 text-indigo-500';
  }
}
