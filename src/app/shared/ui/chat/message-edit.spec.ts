import { describe, expect, it } from 'vitest';
import { editErrorMessage, isWithinEditWindow } from './message-edit';

describe('message-edit (F8, D-64)', () => {
  const sent = '2026-10-31T15:00:00Z';
  const at = (minutes: number) => Date.parse(sent) + minutes * 60_000;
  const policy = { windowMinutes: 15, maxEdits: 5 };

  it('dentro de la ventana y bajo el tope se ofrece "Edit"; fuera, al tope o con ventana 0, no', () => {
    expect(isWithinEditWindow(sent, 0, policy, at(14))).toBe(true);
    expect(isWithinEditWindow(sent, 0, policy, at(16))).toBe(false);
    expect(isWithinEditWindow(sent, 5, policy, at(1))).toBe(false);
    expect(isWithinEditWindow(sent, 0, { windowMinutes: 0, maxEdits: 5 }, at(1))).toBe(false);
  });

  it('sin política (backend viejo) no oculta nada: decide el servidor', () => {
    expect(isWithinEditWindow(sent, 0, null, at(600))).toBe(true);
  });

  it('traduce los códigos de edición rechazada', () => {
    expect(editErrorMessage('Chat.Message.EditWindowExpired')).toBe('This message can no longer be edited.');
    expect(editErrorMessage('Chat.Message.EditLimitReached')).toBe("You've reached the edit limit for this message.");
    expect(editErrorMessage('Other')).toBeNull();
  });
});
