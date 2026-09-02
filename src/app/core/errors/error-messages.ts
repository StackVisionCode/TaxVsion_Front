import { NETWORK_ERROR_CODE, toApiError } from '@core/models/api-error.model';

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

  // Genéricos transversales
  'Auth.Forbidden': "You don't have permission to do that.",
  'RateLimit.Exceeded': "You're going a bit fast. Please wait a moment and try again.",
};

/** Mensaje genérico cuando el código no está catalogado (nunca filtra detalle técnico). */
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Deriva un mensaje LIMPIO para el usuario a partir de cualquier error HTTP.
 * Es el único camino sancionado para mostrar errores en la UI.
 */
export function toUserMessage(err: unknown): string {
  const { code } = toApiError(err);
  return USER_ERROR_MESSAGES[code] ?? GENERIC_MESSAGE;
}
