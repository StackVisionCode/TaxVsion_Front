/**
 * Estado plegado/desplegado de los paneles laterales de los editores de firma (11.1), recordado en
 * localStorage por editor. Todo es best-effort: sin storage (modo privado, bloqueado) se usan los
 * valores por defecto (ambos paneles abiertos) y no se persiste nada.
 */
export interface EditorPanelsState {
  /** Panel izquierdo (firmantes/roles + paleta de campos). */
  leftCollapsed: boolean;
  /** Panel derecho (reglas + resumen). */
  rightCollapsed: boolean;
}

export const DEFAULT_EDITOR_PANELS: EditorPanelsState = { leftCollapsed: false, rightCollapsed: false };

const KEY_PREFIX = 'taxvision.signature.editorPanels.';

export function readEditorPanels(editorKey: string): EditorPanelsState {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + editorKey);
    if (!raw) {
      return { ...DEFAULT_EDITOR_PANELS };
    }
    const parsed = JSON.parse(raw) as Partial<EditorPanelsState>;
    return {
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
    };
  } catch {
    return { ...DEFAULT_EDITOR_PANELS };
  }
}

export function writeEditorPanels(editorKey: string, state: EditorPanelsState): void {
  try {
    localStorage.setItem(
      KEY_PREFIX + editorKey,
      JSON.stringify({ leftCollapsed: state.leftCollapsed, rightCollapsed: state.rightCollapsed }),
    );
  } catch {
    // storage no disponible: el estado vive solo en memoria
  }
}
