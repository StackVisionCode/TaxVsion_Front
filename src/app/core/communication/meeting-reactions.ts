/**
 * Reacciones rápidas del meeting.
 *
 * OJO (contrato): el backend de Communication NO tiene un evento de reacciones para meetings (solo
 * `chat.message.reaction.*` sobre mensajes de chat). Para que la reacción llegue a TODOS los
 * participantes sin tocar el backend, se envía por el chat del meeting (`meeting.chat.send`) como un
 * mensaje cuyo cuerpo es EXACTAMENTE uno de estos emojis. Los clientes que conocen este set lo pintan
 * como reacción flotante y no lo listan como mensaje; un cliente que no lo conoce (p. ej. el Portal)
 * lo verá como un mensaje de chat normal con el emoji. El cuerpo cumple el schema del server
 * (string 1..4000). Si algún día existe un evento dedicado, solo cambia el transporte.
 */
export const MEETING_REACTIONS: readonly { emoji: string; label: string }[] = [
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '👏', label: 'Clap' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '🎉', label: 'Celebrate' },
  { emoji: '🙌', label: 'Raise hands' },
  { emoji: '🤔', label: 'Thinking' },
  { emoji: '👋', label: 'Wave' },
  { emoji: '🔥', label: 'Fire' },
];

const REACTION_SET = new Set(MEETING_REACTIONS.map(r => r.emoji));

/** ¿El cuerpo del mensaje es una reacción? (tolera espacios y la variante sin selector U+FE0F). */
export function isMeetingReaction(body: string | null | undefined): boolean {
  if (!body) {
    return false;
  }
  const trimmed = body.trim();
  return REACTION_SET.has(trimmed) || REACTION_SET.has(`${trimmed}️`);
}

/** Tiempo mínimo entre dos reacciones propias (el chat del meeting tiene rate limit en el server). */
export const REACTION_COOLDOWN_MS = 700;

/** Cuánto vive una reacción flotante en pantalla. */
export const REACTION_TTL_MS = 4000;
