/**
 * Email enmascarado para mostrarlo en la página pública de firma: quien tenga el enlace no
 * debe poder leer la dirección del cliente, pero el firmante sí reconoce su buzón por la
 * inicial y el dominio. La cantidad de puntos es fija para no revelar el largo real.
 *
 *   juan.perez@gmail.com → j•••••@gmail.com
 */
export function maskEmail(email: string | null | undefined): string {
  const value = String(email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return '•••••';
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.length > 1 ? local[0] : '';
  return `${visible}•••••@${domain}`;
}
