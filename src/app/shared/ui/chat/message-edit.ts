/** F8 (D-64): ventana de edición del chat (minutos desde el envío; 0 = no se edita) y tope de ediciones. */
export interface ChatEditPolicy {
  windowMinutes: number;
  maxEdits: number;
}

/**
 * ¿Se muestra "Edit"? Mismo criterio que el servidor (que es quien manda). Sin política (backend viejo)
 * no se oculta: el servidor rechaza si corresponde.
 */
export function isWithinEditWindow(
  createdAtUtc: string,
  editCount: number,
  policy: ChatEditPolicy | null | undefined,
  nowMs: number,
): boolean {
  if (!policy) return true;
  if (policy.windowMinutes <= 0 || editCount >= policy.maxEdits) return false;
  const created = Date.parse(createdAtUtc);
  return Number.isNaN(created) || nowMs <= created + policy.windowMinutes * 60_000;
}

const EDIT_ERRORS: Record<string, string> = {
  'Chat.Message.EditWindowExpired': 'This message can no longer be edited.',
  'Chat.Message.EditLimitReached': "You've reached the edit limit for this message.",
  'Chat.Message.EditDisabled': "Messages in this chat can't be edited.",
  'Chat.Conversation.Archived': 'This conversation is closed.',
  'Chat.Conversation.NotParticipant': "You're no longer part of this conversation.",
};

/** Texto para el toast de una edición rechazada; null = usar el genérico. */
export function editErrorMessage(code: string): string | null {
  return EDIT_ERRORS[code] ?? null;
}
