/**
 * Preferencia local "panel derecho plegado" de los editores de firma (inspector / "Before you
 * continue"). Vive en localStorage por comodidad del usuario: si no hay storage (modo privado,
 * datos bloqueados) se lee `false` y la escritura se ignora — la UI funciona igual.
 */

/** Editor de campos del wizard (signature-pdf-editor). */
export const PDF_EDITOR_INSPECTOR_COLLAPSED_KEY = 'signature.editor.inspectorCollapsed';
/** Editor de plantillas (signature-template-editor). */
export const TEMPLATE_EDITOR_INSPECTOR_COLLAPSED_KEY = 'signature.templateEditor.inspectorCollapsed';

export function readPanelCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writePanelCollapsed(key: string, collapsed: boolean): void {
  try {
    if (collapsed) {
      localStorage.setItem(key, '1');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Sin storage: la preferencia dura solo esta sesión (el signal ya tiene el valor).
  }
}
