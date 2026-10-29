import { parseUtcDate } from '@shared/utils/utc-date.util';
import type { StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type { ClientNoteCard, NoteAttachmentStatus } from '../data-access/client-notes.model';

/** Una nota es "larga" (se recorta con "Show more") por caracteres o por líneas. */
const LONG_NOTE_CHARS = 420;
const LONG_NOTE_LINES = 6;

export interface NoteDayGroup {
  key: string;
  label: string;
  notes: ClientNoteCard[];
}

/**
 * El editor es de texto plano, pero el contrato de Notes guarda HTML (`NoteContent.Html`, sanitizado
 * en el servidor). Se escapa el texto y los saltos pasan a `<br>`: lo que se escribe es lo que se ve.
 */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/\r?\n/g, '<br>');
}

/** Camino inverso para el editor: el HTML del backend se degrada a texto plano (sin ejecutar nada, vía DOMParser). */
export function htmlToPlainText(html: string): string {
  const parsed = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (parsed.body.textContent ?? '').trim();
}

export function isLongNote(plainText: string): boolean {
  return plainText.length > LONG_NOTE_CHARS || plainText.split('\n').length > LONG_NOTE_LINES;
}

/** Más reciente primero por fecha de creación (el feed es una línea de tiempo). */
export function sortNotesNewestFirst(notes: readonly ClientNoteCard[]): ClientNoteCard[] {
  return [...notes].sort((a, b) => parseUtcDate(b.createdAtUtc).getTime() - parseUtcDate(a.createdAtUtc).getTime());
}

/** "Today" / "Yesterday" / "Mon, Oct 20" / "Mon, Oct 20, 2025" (otro año), en hora local. */
export function noteDayLabel(isoUtc: string, now: number | Date = Date.now()): string {
  const date = parseUtcDate(isoUtc);
  const today = startOfLocalDay(now instanceof Date ? now : new Date(now));
  const diffDays = Math.round((today.getTime() - startOfLocalDay(date).getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Agrupa (ya ordenadas) por día local de creación. */
export function groupNotesByDay(notes: readonly ClientNoteCard[], now: number | Date = Date.now()): NoteDayGroup[] {
  const groups: NoteDayGroup[] = [];
  for (const note of notes) {
    const day = startOfLocalDay(parseUtcDate(note.createdAtUtc));
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.notes.push(note);
    } else {
      groups.push({ key, label: noteDayLabel(note.createdAtUtc, now), notes: [note] });
    }
  }
  return groups;
}

/** Icono por tipo de archivo (todos registrados en main.ts). */
export function attachmentIcon(contentType: string, name: string): string {
  const type = (contentType || '').toLowerCase();
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image-outline';
  if (type === 'application/pdf' || ext === 'pdf') return 'document-text-outline';
  if (type.includes('sheet') || type.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) return 'grid-outline';
  if (type.startsWith('audio/')) return 'musical-notes-outline';
  if (type.startsWith('video/')) return 'videocam-outline';
  return 'document-outline';
}

export function attachmentStatusLabel(status: NoteAttachmentStatus): string {
  switch (status) {
    case 'Available':
      return 'Ready';
    case 'Pending':
      return 'Scanning…';
    case 'Rejected':
      return 'Blocked';
    case 'Detached':
      return 'Removed';
  }
}

export function attachmentStatusTone(status: NoteAttachmentStatus): StatusTone {
  switch (status) {
    case 'Available':
      return 'success';
    case 'Pending':
      return 'warning';
    case 'Rejected':
      return 'danger';
    case 'Detached':
      return 'muted';
  }
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Textarea que crece con el contenido hasta `maxPx`; a partir de ahí hace scroll. */
export function autosizeTextarea(el: HTMLTextAreaElement | null | undefined, maxPx: number): void {
  if (!el) return;
  el.style.height = 'auto';
  const full = el.scrollHeight;
  el.style.height = `${Math.min(full, maxPx)}px`;
  el.style.overflowY = full > maxPx ? 'auto' : 'hidden';
}

/** Ctrl+Enter (o ⌘+Enter en Mac) = guardar. */
export function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing;
}

/** Etiqueta del atajo según la plataforma. */
export function submitShortcutLabel(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘ Enter' : 'Ctrl Enter';
}
