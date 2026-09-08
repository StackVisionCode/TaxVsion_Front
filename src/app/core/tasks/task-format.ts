import { ApiTaskPriority } from './task-contract.model';

/**
 * Helpers de presentación de Tasks, únicos. Antes estaban triplicados en task-board,
 * dashboard-tasks y client-profile-work, con divergencias reales (el chip `Low` salía verde en dos
 * y gris en el dashboard; el formato de fecha tenía tres redacciones distintas). Aquí viven una vez.
 */

/** Clase del chip de prioridad (borde + texto). Canónico: `Low` = esmeralda (era la mayoría). */
export function priorityChipClass(priority: ApiTaskPriority): string {
  switch (priority) {
    case 'Urgent':
      return 'border-red-200 text-red-500';
    case 'High':
      return 'border-orange-200 text-orange-500';
    case 'Normal':
      return 'border-amber-200 text-amber-600';
    case 'Low':
      return 'border-emerald-200 text-emerald-600';
  }
}

/**
 * Fecha de vencimiento relativa, redacción del tablero/dashboard:
 * '' → 'No due date'; 0 → 'Today'; 1 → 'Tomorrow'; -1 → 'Yesterday'; pasado → 'N days ago';
 * futuro → 'In N days'. Con guarda de NaN (fecha inválida → 'No due date').
 */
export function formatRelativeDue(dueDate: string | null | undefined): string {
  if (!dueDate) {
    return 'No due date';
  }
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    return 'No due date';
  }
  const today = new Date();
  const diffDays = Math.round((startOfDay(due) - startOfDay(today)) / 86_400_000);
  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Tomorrow';
  }
  if (diffDays === -1) {
    return 'Yesterday';
  }
  return diffDays < 0 ? `${Math.abs(diffDays)} days ago` : `In ${diffDays} days`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
