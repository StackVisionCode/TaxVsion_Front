/**
 * T-20: textos de la moderación de contenido para cualquier archivo subido (notas, tareas, pedidos,
 * formularios, correo). El motivo técnico del escaneo nunca se muestra tal cual.
 */
export const FILE_UNDER_REVIEW_LABEL = 'Under review';
export const FILE_UNDER_REVIEW_HINT =
  'This file is being reviewed against our content policy. It will be available once approved.';
export const FILE_BLOCKED_BY_POLICY_TEXT = 'Blocked: this file goes against our content policy';
export const FILE_BLOCKED_BY_SCAN_TEXT = 'Blocked by the security scan';

/** Los servicios usan `blocked-by-policy` (Notes/Tasks) o `blocked_by_policy` (Client Forms). */
export function isBlockedByPolicy(reason: string | null | undefined): boolean {
  return reason === 'blocked-by-policy' || reason === 'blocked_by_policy';
}

/** Motivo de un archivo rechazado, en palabras del usuario. */
export function rejectedFileText(reason: string | null | undefined): string {
  return isBlockedByPolicy(reason) ? FILE_BLOCKED_BY_POLICY_TEXT : FILE_BLOCKED_BY_SCAN_TEXT;
}
