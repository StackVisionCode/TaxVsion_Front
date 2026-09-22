import { WizardClient } from '../ui/signature-request-panel/signature-wizard.model';

/** Últimos clientes elegidos en el wizard, para reenviar sin volver a buscar (por-feature, como en mail). */
const RECENT_KEY = 'signature.recentClients';
const RECENT_CAP = 5;

export function readRecentClients(): WizardClient[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as WizardClient[]) : [];
  } catch {
    return [];
  }
}

/** Devuelve la lista con `client` al frente, sin duplicados y topada; además la persiste. */
export function pushRecentClient(current: WizardClient[], client: WizardClient): WizardClient[] {
  const next = [client, ...current.filter(c => c.id !== client.id)].slice(0, RECENT_CAP);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage no disponible (modo privado): los recientes son un lujo, no un requisito.
  }
  return next;
}
