import {
  FieldType,
  RequestRules,
  VerificationChannel,
  WizardClient,
  WizardDocKind,
  WizardDocument,
} from './signature-wizard.model';

/**
 * Datos mock locales de la feature signature. No se importan de las features
 * clients/documents (la arquitectura prohíbe imports entre features); se
 * replica un subset representativo, igual que cada feature mantiene su propio seed.
 */
export const WIZARD_CLIENTS: WizardClient[] = [
  { id: 'client-1', displayName: 'Maria Gonzalez', email: 'maria.gonzalez@email.com', phone: '(305) 555-0134', type: 'individual', isActive: true, createdAt: '2023-02-14' },
  { id: 'client-2', displayName: 'David Chen', email: 'david.chen@email.com', phone: '(786) 555-0192', type: 'individual', isActive: true, createdAt: '2024-01-08' },
  { id: 'client-3', displayName: 'Sunrise Bakery Inc.', email: 'billing@sunrisebakery.com', phone: '(305) 555-0177', type: 'company', isActive: true, createdAt: '2022-09-30' },
  { id: 'client-4', displayName: 'Sarah Johnson', email: 'sarah.johnson@email.com', phone: '(954) 555-0119', type: 'individual', isActive: true, createdAt: '2023-11-21' },
  { id: 'client-5', displayName: 'Robert Kim', email: 'robert.kim@email.com', phone: '(305) 555-0163', type: 'individual', isActive: false, createdAt: '2021-06-02' },
  { id: 'client-6', displayName: 'Acme Consulting LLC', email: 'accounts@acmeconsulting.com', phone: '(786) 555-0148', type: 'company', isActive: true, createdAt: '2024-03-17' },
  { id: 'client-7', displayName: 'Lisa Martinez', email: 'lisa.martinez@email.com', phone: '(954) 555-0126', type: 'individual', isActive: true, createdAt: '2022-12-05' },
  { id: 'client-8', displayName: 'Thomas Anderson', email: 'thomas.anderson@email.com', phone: '(305) 555-0181', type: 'individual', isActive: false, createdAt: '2023-07-19' },
];

export const WIZARD_DOCUMENTS: WizardDocument[] = [
  { id: 'doc-1', name: 'Engagement Letter.pdf', kind: 'pdf', size: '182 KB', date: 'Jun 21, 2026', blob: null },
  { id: 'doc-2', name: 'Form 8879 E-file Authorization.pdf', kind: 'pdf', size: '96 KB', date: 'Jun 27, 2026', blob: null },
  { id: 'doc-3', name: '2025 Tax Return Signature Page.pdf', kind: 'pdf', size: '1.2 MB', date: 'Jul 2, 2026', blob: null },
  { id: 'doc-4', name: 'POA Form 2848.pdf', kind: 'pdf', size: '240 KB', date: 'May 30, 2026', blob: null },
  { id: 'doc-5', name: 'W-9 Request.pdf', kind: 'pdf', size: '78 KB', date: 'Jun 9, 2026', blob: null },
  { id: 'doc-6', name: 'Amendment Authorization.pdf', kind: 'pdf', size: '154 KB', date: 'Jul 6, 2026', blob: null },
];

const AVATAR_COLORS = ['bg-indigo-500', 'bg-orange-500', 'bg-[#7C6AE0]', 'bg-emerald-500', 'bg-gray-900'];

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
  return type === 'company' ? 'border-[#F2E3C9] text-orange-600' : 'border-[#CBD9F2] text-indigo-600';
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
      return 'bg-[#F2E3C9]';
    case 'xlsx':
      return 'bg-[#CBD9F2]';
    case 'img':
      return 'bg-[#DCDCDC]';
    case 'doc':
      return 'bg-[#EEEBFA]';
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
  signature: 'bg-[#F2E3C9]',
  initials: 'bg-[#EEEBFA]',
  date: 'bg-[#CBD9F2]',
  text: 'bg-[#DCDCDC]',
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
