import { Injectable } from '@angular/core';

/**
 * Copiar al portapapeles con fallback.
 *
 * `copy(text)` intenta `navigator.clipboard.writeText` y, si no existe (http plano, contextos no
 * seguros) o lo rechaza (permiso), cae al truco del `<textarea>` + `execCommand('copy')` — la misma
 * estrategia de referrals-page. Resuelve `true` si alguna de las dos funcionó; nunca rechaza.
 *
 * Normalizado: referrals mostraba "Copied!" aunque ambos métodos fallaran; aquí el llamador recibe el
 * resultado real y decide el feedback.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  async copy(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Sigue al fallback.
      }
    }
    return this.copyWithTextarea(text);
  }

  private copyWithTextarea(text: string): boolean {
    if (typeof document === 'undefined') {
      return false;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
