import { NETWORK_ERROR_CODE, SERVICE_UNAVAILABLE_MESSAGE, toApiError } from '@core/models/api-error.model';
import { readThrottle, throttleMessage } from './throttling';

/**
 * Traducción de códigos de error del backend a mensajes claros, en inglés y
 * SIN jerga técnica, para mostrar al usuario. El backend manda un `code`
 * estable (BuildingBlocks.Results.Error); acá lo mapeamos a una frase amable.
 *
 * Regla de seguridad: `toUserMessage` NUNCA devuelve el `message` crudo del
 * backend ni el `err.message` de Angular (que incluye la URL del API). Si el
 * código no está en este catálogo, cae a un genérico seguro. Así ningún GUID,
 * URL ni detalle interno se filtra a la interfaz.
 */
const USER_ERROR_MESSAGES: Record<string, string> = {
  // Red / conexión
  [NETWORK_ERROR_CODE]: "We couldn't reach the server. Check your connection and try again.",
  // 503 transitorio que no es load shedding (servicio caído, denylist de sesión sin Redis).
  'Http.503': SERVICE_UNAVAILABLE_MESSAGE,
  'Auth.SessionDenylistUnavailable': SERVICE_UNAVAILABLE_MESSAGE,

  // CloudStorage — archivos
  'File.NotFound': "We couldn't find that file.",
  'File.NotAvailable': 'This file is still being processed. Try again in a moment.',
  'File.Forbidden': "You don't have access to this file.",
  'File.TooLarge': "This file is larger than your firm's upload limit.",
  'File.UnsupportedType': "This file type isn't supported.",
  'File.YearRequired': 'Please choose a tax year for this file.',
  'File.UploadSizeMismatch': "The upload didn't finish correctly. Please try again.",
  'File.MultipartCompleteFailed': "The upload didn't finish correctly. Please try again.",
  'File.TooManyItems': 'You selected too many files at once. Try fewer.',
  'File.TooManyFolders': 'You selected too many folders at once. Try fewer.',
  'File.ZipTooLarge': 'That download is too large. Select fewer items.',

  // CloudStorage — carpetas
  'Folder.NotFound': "We couldn't find that folder.",
  'Folder.NotEmpty': 'This folder must be empty before it can be deleted.',
  'Folder.HasLegalHold': "This folder can't be deleted because it contains files on legal hold.",
  'Folder.Forbidden': "You don't have access to this folder.",
  'Folder.InvalidName': "That name isn't allowed. Avoid slashes and special characters.",
  'Folder.CircularReference': "You can't move a folder into itself.",

  // CloudStorage — cuota
  'StorageQuota.Exceeded': "Your firm has reached its storage limit.",
  'StorageQuota.FileTooLarge': "This file is larger than your firm's upload limit.",
  'StorageQuota.Suspended': 'File storage is temporarily unavailable for your firm.',

  // CloudStorage — compartir
  'ShareLink.NotFound': "That shared link is no longer available.",
  'ShareLink.Forbidden': "You don't have permission to share this.",
  'ShareLink.AlreadyRevoked': 'That link has already been revoked.',
  'ShareLink.PublicSharingDisabled':
    "Public links are turned off by your firm's security settings.",
  'ShareLink.LinkSharingDisabled':
    "Secure links are turned off by your firm's security settings.",
  'ShareLink.PasswordRequiredForLinkShare':
    'Your firm requires a password on secure links. Add one and try again.',
  'ShareLink.ShareLifetimeExceedsMax':
    'Secure links can last at most 30 days. Choose an earlier expiration date.',
  'ShareLink.ExpirationInPast': 'The expiration date must be in the future.',
  'ShareLink.InvalidMaxAccessCount': 'Maximum opens must be a positive number.',
  'ShareLink.RecipientsRequired': 'Add at least one recipient for this type of link.',
  'ShareLink.ElevatedPermissionRequiresManage':
    "You don't have permission to grant that access level.",
  'ShareLink.ElevatedPermissionNotAllowedOnPublicLink':
    "Open links can't grant upload or edit access.",

  // Billing → Inventory (descuento de stock al emitir la factura)
  'inventory.insufficientStock':
    "There isn't enough stock to issue this invoice. Adjust the product's inventory and try again.",
  'Billing.Inventory.Unreachable':
    "We couldn't check inventory just now, so the invoice wasn't issued. Please try again in a moment.",
  'Billing.Inventory.CommitFailed':
    "We couldn't check inventory just now, so the invoice wasn't issued. Please try again in a moment.",
  'Billing.Inventory.TokenFailed':
    "We couldn't check inventory just now, so the invoice wasn't issued. Please try again in a moment.",

  // Suscripción — ciclo de vida (Expiración/Dunning)
  'Auth.SubscriptionInactive':
    "Your firm's subscription is inactive. Renew it to restore access for your team.",
  'Subscription.CannotSelfServiceRenew':
    "This subscription can't be renewed right now.",
  'Subscription.RenewalCheckout.ProviderError':
    "We couldn't start the payment. Please try again in a moment.",
  'Subscription.RenewalCheckout.Unavailable':
    'The payment service is temporarily unavailable. Please try again shortly.',

  // Genéricos transversales (rate limit y load shedding se resuelven en `toUserMessage` vía readThrottle)
  'Auth.Forbidden': "You don't have permission to do that.",
};

/** Mensaje genérico cuando el código no está catalogado (nunca filtra detalle técnico). */
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Deriva un mensaje LIMPIO para el usuario a partir de cualquier error HTTP.
 * Es el único camino sancionado para mostrar errores en la UI.
 */
export function toUserMessage(err: unknown): string {
  const throttle = readThrottle(err);
  if (throttle) {
    return throttleMessage(throttle);
  }
  const { code } = toApiError(err);
  return USER_ERROR_MESSAGES[code] ?? GENERIC_MESSAGE;
}
