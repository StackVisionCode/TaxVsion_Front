/** F8a — textos de los rechazos del chat de la sala (D-14, D-15, INV-10 H-7). */
const MEETING_CHAT_ERRORS: Record<string, string> = {
  'Meeting.Chat.GuestTextOnly': 'Guests can only send text messages.',
  'Meeting.Chat.AttachmentLimit': 'You reached the file limit for this meeting.',
  'Meeting.Chat.AttachmentRateLimited': 'Too many files, wait a moment.',
  'Auth.Forbidden': "You don't have permission to chat in this meeting.",
  'Chat.Conversation.Archived': 'This meeting chat is closed.',
};

export function meetingChatErrorMessage(code: string | null): string | null {
  return code ? (MEETING_CHAT_ERRORS[code] ?? null) : null;
}
