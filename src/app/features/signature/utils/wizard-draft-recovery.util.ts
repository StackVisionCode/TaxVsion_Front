import { EditorSeed, WizardClient } from '../ui/signature-request-panel/signature-wizard.model';

/**
 * Snapshot local (no servidor) del wizard en curso para recuperar el trabajo ante una recarga o cierre
 * accidental del navegador. Es liviano y seguro para el performance: se escribe SOLO al ocultarse/cerrarse
 * la página (pagehide/visibilitychange) y cuando ya hay campos colocados — nunca en cada tecla ni por red.
 *
 * NO guarda imágenes de firma (solo fileIds + posiciones), así que no persiste datos manuscritos sensibles
 * (misma precaución que "My Signature", que a propósito no toca localStorage con la imagen).
 */
/** Documento del wizard: `id` es el localId al que apuntan los campos de la siembra. */
export interface WizardDraftSnapshotDocument {
  id: string;
  fileId: string;
  name: string;
}

export interface WizardDraftSnapshot {
  /** epoch ms; sirve para caducar snapshots viejos. */
  savedAt: number;
  clients: WizardClient[];
  documents: WizardDraftSnapshotDocument[];
  title: string;
  category: string;
  dueDate: string;
  notes: string;
  /** Estado del editor (firmantes + campos normalizados + reglas + firma del preparador elegida). */
  seed: EditorSeed;
}

const STORAGE_KEY = 'signature.wizard.draft';
/** Caducidad: un snapshot de más de 24h probablemente ya no interesa. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readDraftSnapshot(): WizardDraftSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = upgradeLegacySnapshot(JSON.parse(raw));
    if (
      !parsed?.clients?.length ||
      !parsed.documents?.length ||
      Date.now() - parsed.savedAt > MAX_AGE_MS
    ) {
      clearDraftSnapshot();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Formato anterior: un solo cliente y un solo documento (cuyo localId era su fileId). */
interface LegacyWizardDraftSnapshot extends Omit<WizardDraftSnapshot, 'clients' | 'documents'> {
  client?: WizardClient;
  documentFileId?: string;
  documentName?: string;
}

function upgradeLegacySnapshot(
  value: WizardDraftSnapshot | LegacyWizardDraftSnapshot | null,
): WizardDraftSnapshot | null {
  if (!value || 'clients' in value) {
    return value as WizardDraftSnapshot | null;
  }
  const { client, documentFileId, documentName, ...rest } = value;
  return {
    ...rest,
    clients: client ? [client] : [],
    documents: documentFileId
      ? [{ id: documentFileId, fileId: documentFileId, name: documentName ?? 'Document' }]
      : [],
  };
}

export function writeDraftSnapshot(snapshot: WizardDraftSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Cuota llena / modo privado: la recuperación es best-effort, nunca rompe el flujo.
  }
}

export function clearDraftSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
