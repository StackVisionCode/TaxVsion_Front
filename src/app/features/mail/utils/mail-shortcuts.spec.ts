import { describe, expect, it } from 'vitest';
import { MAIL_SHORTCUTS, shortcutFor } from './mail-shortcuts';

const key = (k: string, over: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target, ...over }) as KeyboardEvent;

// Atajos de una tecla del módulo Mail: nunca mientras se escribe ni con modificadores.
describe('shortcutFor', () => {
  it('traduce cada tecla de la ayuda a su acción', () => {
    for (const shortcut of MAIL_SHORTCUTS) {
      expect(shortcutFor(key(shortcut.key))).toBe(shortcut.action);
    }
  });

  it('ignora teclas sin atajo', () => {
    expect(shortcutFor(key('x'))).toBeNull();
    expect(shortcutFor(key('Enter'))).toBeNull();
  });

  it('ignora Ctrl/Cmd/Alt (Ctrl+C sigue copiando)', () => {
    expect(shortcutFor(key('c', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('c', { metaKey: true }))).toBeNull();
    expect(shortcutFor(key('e', { altKey: true }))).toBeNull();
  });

  it('no actúa mientras se escribe en un campo o en el editor', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(editor);

    expect(shortcutFor(key('c', {}, input))).toBeNull();
    expect(shortcutFor(key('j', {}, textarea))).toBeNull();
    expect(shortcutFor(key('r', {}, editor))).toBeNull();

    editor.remove();
  });
});
