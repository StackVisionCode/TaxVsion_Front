import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ClientNote {
  id: string;
  author: string;
  avatarColor: string;
  timestamp: string;
  text: string;
}

const MOCK_NOTES: ClientNote[] = [
  {
    id: 'note-1',
    author: 'Maria Chen',
    avatarColor: 'bg-indigo-500',
    timestamp: 'Jun 29, 2026',
    text: 'Called to confirm the Q2 estimated payment amount. Client prefers email over phone for future reminders.',
  },
  {
    id: 'note-2',
    author: 'David Ruiz',
    avatarColor: 'bg-orange-500',
    timestamp: 'Jun 12, 2026',
    text: 'Reminder: client is waiting on a corrected 1099-NEC from a contractor before we can finalize the return.',
  },
  {
    id: 'note-3',
    author: 'Maria Chen',
    avatarColor: 'bg-indigo-500',
    timestamp: 'May 30, 2026',
    text: 'Client asked about switching to quarterly bookkeeping check-ins instead of monthly. Follow up next renewal.',
  },
  {
    id: 'note-4',
    author: 'You',
    avatarColor: 'bg-gray-900',
    timestamp: 'Apr 18, 2026',
    text: 'Uploaded prior-year return to the documents tab per client request for their mortgage application.',
  },
];

/**
 * Pestaña "Notes" del perfil de cliente (estilo "Aether"): input píldora +
 * botón negro "Add note" que antepone una nota nueva a una lista local
 * respaldada por signal (autor "You", timestamp "Just now"). Cada nota se
 * renderiza como tarjeta con avatar de inicial, autor, timestamp y texto.
 * Datos mock estáticos, independientes del `clientId` recibido.
 */
@Component({
  selector: 'app-client-profile-notes',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-notes.component.html',
})
export class ClientProfileNotesComponent {
  @Input() clientId = '';

  readonly notes = signal<ClientNote[]>([...MOCK_NOTES]);
  readonly draftText = signal('');

  addNote(): void {
    const text = this.draftText().trim();
    if (!text) {
      return;
    }
    const note: ClientNote = {
      id: `note-new-${Date.now()}`,
      author: 'You',
      avatarColor: 'bg-gray-900',
      timestamp: 'Just now',
      text,
    };
    this.notes.update(notes => [note, ...notes]);
    this.draftText.set('');
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }
}
