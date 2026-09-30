import { chatStartErrorMessage } from './chat-start-error';

describe('chatStartErrorMessage', () => {
  it('explica que el cliente no está asignado en vez de un error genérico', () => {
    const message = chatStartErrorMessage(
      'Chat.NotAssignedPreparer',
      'This tenant only allows customers to chat with staff assigned to them.',
    );

    expect(message).toBe('You can only chat with clients assigned to you. Ask an admin to assign this client to you.');
  });

  it('sin permiso de chat sugiere el plan', () => {
    expect(chatStartErrorMessage('Auth.Forbidden', 'Missing communication.chat.start')).toContain('plan upgrade');
  });

  it('sin conexión pide reintentar', () => {
    expect(chatStartErrorMessage('Socket.Timeout', '')).toBe("Couldn't reach the chat server. Please try again.");
  });
});
