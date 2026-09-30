/**
 * Traduce el ack de error de iniciar un chat a un mensaje de usuario, sin filtrar códigos de permiso.
 * `Chat.NotAssignedPreparer`: la oficina limita el chat con clientes al staff asignado a cada uno.
 */
export function chatStartErrorMessage(code: string, message: string): string {
  if (code === 'Chat.NotAssignedPreparer') {
    return 'You can only chat with clients assigned to you. Ask an admin to assign this client to you.';
  }
  if (/^Missing communication|forbidden|permission|not allowed|not assigned/i.test(message) || /forbidden|permission/i.test(code)) {
    return "You don't have access to start chats yet. This may require a plan upgrade.";
  }
  if (code === 'Socket.NotConnected' || code === 'Socket.Timeout') {
    return "Couldn't reach the chat server. Please try again.";
  }
  return 'Could not start the conversation.';
}
