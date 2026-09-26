import { EditorSeed, WizardClient } from '../ui/signature-request-panel/signature-wizard.model';

/**
 * Snapshot local (no servidor) del wizard en curso para recuperar el trabajo ante una recarga o cierre
 * accidental del navegador. Es liviano y seguro para el performance: se escribe SOLO al ocultarse/cerrarse
 * la página (pagehide/visibilitychange) y cuando ya hay campos colocados — nunca en cada tecla ni por red.
 *
 * NO guarda imágenes de firma (solo fileIds + posiciones), así que no persiste datos manuscritos sensibles
 * (misma precaución que "My Signature", que a propósito no toca localStorage con la imagen).
 */
export interface WizardDraftSnapshot {
  /** epoch ms; sirve para caducar snapshots viejos. */
  savedAt: number;
  client: WizardClient;
  documentFileId: string;
  documentName: string;
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
    const parsed = JSON.parse(raw) as WizardDraftSnapshot;
    if (!parsed?.documentFileId || !parsed?.client || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearDraftSnapshot();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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
