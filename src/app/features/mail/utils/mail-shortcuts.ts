/** Acciones de teclado del módulo Mail (estilo Gmail, sin modificadores). */
export type MailShortcut = 'next' | 'previous' | 'archive' | 'markUnread' | 'reply' | 'compose' | 'search' | 'help';

/** Atajo y su descripción, en el orden en que se muestran en la ayuda (`?`). */
export interface MailShortcutHelp {
  key: string;
  action: MailShortcut;
  description: string;
}

export const MAIL_SHORTCUTS: readonly MailShortcutHelp[] = [
  { key: 'j', action: 'next', description: 'Next conversation' },
  { key: 'k', action: 'previous', description: 'Previous conversation' },
  { key: 'e', action: 'archive', description: 'Archive (or move back to Inbox)' },
  { key: 'u', action: 'markUnread', description: 'Mark conversation as unread' },
  { key: 'r', action: 'reply', description: 'Reply to the latest message' },
  { key: 'c', action: 'compose', description: 'New message' },
  { key: '/', action: 'search', description: 'Search mail' },
  { key: '?', action: 'help', description: 'Show keyboard shortcuts' },
];

const BY_KEY: ReadonlyMap<string, MailShortcut> = new Map(MAIL_SHORTCUTS.map(item => [item.key, item.action]));

/**
 * La acción de una tecla, o null. Nunca mientras se escribe (input, textarea, select, editor) ni con
 * Ctrl/Cmd/Alt: así "c" en el buscador escribe una c y Ctrl+C sigue copiando.
 */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>): MailShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) {
    return null;
  }
  return BY_KEY.get(event.key) ?? null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  // El ancestro cubre el párrafo con foco dentro del editor (y entornos sin `isContentEditable`).
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    !!target.closest('[contenteditable]:not([contenteditable="false"])')
  );
}
