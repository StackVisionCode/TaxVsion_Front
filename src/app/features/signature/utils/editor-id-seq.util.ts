/**
 * Secuencia de ids locales del editor (`signer-N`, `field-N`, `prep-N`).
 *
 * El editor numera con un contador `seq` que arrancaba en 0. Al sembrar un borrador o restaurar
 * un snapshot local, los ids restaurados ya traen sufijos (p. ej. `field-3`), y el siguiente campo
 * nuevo podía repetir `field-0`… hasta chocar → dos campos con el mismo id (el diff del borrador y
 * el trackBy se confunden). `nextSeqAfter` devuelve el primer número libre por encima del mayor
 * sufijo existente, para cualquier prefijo de la lista.
 *
 * Uso:
 *   this.seq = nextSeqAfter([...signers.map(s => s.id), ...fields.map(f => f.id)]);
 *
 * Reutilizable por el editor de plantillas pasando sus propios prefijos.
 */
export const EDITOR_ID_PREFIXES: readonly string[] = ['signer', 'field', 'prep'];

export function nextSeqAfter(
  ids: Iterable<string>,
  prefixes: readonly string[] = EDITOR_ID_PREFIXES,
): number {
  let max = -1;
  for (const id of ids) {
    for (const prefix of prefixes) {
      const head = `${prefix}-`;
      if (!id.startsWith(head)) {
        continue;
      }
      const suffix = id.slice(head.length);
      if (/^\d+$/.test(suffix)) {
        max = Math.max(max, Number(suffix));
      }
    }
  }
  return max + 1;
}
