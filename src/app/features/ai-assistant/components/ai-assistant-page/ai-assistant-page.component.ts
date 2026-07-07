import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AiChatThreadComponent, AiChatMessage } from '../../ui/ai-chat-thread/ai-chat-thread.component';
import { AiChatComposerComponent } from '../../ui/ai-chat-composer/ai-chat-composer.component';

interface Conversation {
  id: string;
  title: string;
  preview: string;
  messages: AiChatMessage[];
}

const CANNED_REPLIES = [
  'Based on current IRS guidance, home office deductions require the space to be used regularly and exclusively for business. I can help you calculate the simplified or actual-expense method — which would you like to use?',
  "I've reviewed the filing timeline: this client is currently in the 'In review' stage, with all required documents received. The estimated completion date is in 3 business days.",
  "Here's a draft reminder: \"Hi {{name}}, we're missing your W-2 for tax year 2025. Please upload it through your client portal at your earliest convenience so we can continue preparing your return.\"",
  'Great question — I can pull the relevant deduction categories once you confirm the client type (individual, sole proprietor, or S-corp). Let me know and I\'ll outline the applicable rules.',
];

let replyIndex = 0;

function nowLabel(): string {
  return 'Just now';
}

/**
 * Página del AI Assistant (estilo "Aether"): rail de conversaciones recientes
 * + hilo de chat con respuestas simuladas localmente (sin backend real). El
 * "escribiendo..." se muestra ~900ms antes de la respuesta enlatada.
 */
@Component({
  selector: 'app-ai-assistant-page',
  imports: [CommonModule, AiChatThreadComponent, AiChatComposerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './ai-assistant-page.component.html',
})
export class AiAssistantPageComponent {
  readonly conversations = signal<Conversation[]>([
    {
      id: 'conv-1',
      title: 'Home office deduction',
      preview: 'What deductions apply to...',
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'What deductions apply to home offices?',
          time: '9:12 AM',
        },
        {
          id: 'm2',
          role: 'ai',
          text: CANNED_REPLIES[0],
          time: '9:12 AM',
        },
      ],
    },
    {
      id: 'conv-2',
      title: 'Gonzalez filing status',
      preview: 'Summarize this client\'s...',
      messages: [
        { id: 'm3', role: 'user', text: "Summarize this client's filing status", time: 'Yesterday' },
        { id: 'm4', role: 'ai', text: CANNED_REPLIES[1], time: 'Yesterday' },
      ],
    },
    {
      id: 'conv-3',
      title: 'Missing W-2 reminder',
      preview: 'Draft a reminder email...',
      messages: [
        { id: 'm5', role: 'user', text: 'Draft a reminder email for missing W-2 forms', time: 'Mon' },
        { id: 'm6', role: 'ai', text: CANNED_REPLIES[2], time: 'Mon' },
      ],
    },
    {
      id: 'conv-4',
      title: 'New conversation',
      preview: 'Start a new chat',
      messages: [],
    },
  ]);

  readonly activeConversationId = signal('conv-1');
  readonly isTyping = signal(false);

  get activeConversation(): Conversation {
    return this.conversations().find(c => c.id === this.activeConversationId()) ?? this.conversations()[0];
  }

  selectConversation(id: string): void {
    this.activeConversationId.set(id);
  }

  startNewChat(): void {
    this.conversations.update(list =>
      list.map(c => (c.id === this.activeConversationId() ? { ...c, messages: [] } : c)),
    );
  }

  sendMessage(text: string): void {
    const userMessage: AiChatMessage = { id: `u-${Date.now()}`, role: 'user', text, time: nowLabel() };
    this.appendMessage(userMessage);
    this.isTyping.set(true);

    setTimeout(() => {
      const reply = CANNED_REPLIES[replyIndex % CANNED_REPLIES.length];
      replyIndex++;
      this.appendMessage({ id: `a-${Date.now()}`, role: 'ai', text: reply, time: nowLabel() });
      this.isTyping.set(false);
    }, 900);
  }

  private appendMessage(message: AiChatMessage): void {
    this.conversations.update(list =>
      list.map(c =>
        c.id === this.activeConversationId() ? { ...c, messages: [...c.messages, message] } : c,
      ),
    );
  }
}
