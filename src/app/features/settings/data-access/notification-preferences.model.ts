/**
 * Preferencias de notificación del staff — contrato del backend
 * (`GET/PUT /notifications/preferences` en Notification service). FASE 8 del plan.
 *
 * Categorías del enum real `NotificationCategory` del backend
 * (`TaxVision.Notification.Domain.Preferences.NotificationCategory`).
 * `AccountSecurity` es `Locked=true` por diseño (nunca se puede apagar), el UI
 * muestra el toggle deshabilitado on.
 *
 * NOTA: el MD de FASE 8 propone renombrar a `Security | Work | Clients | ...`
 * y migrar las filas, pero ese renombre cross-service es trabajo propio
 * (afecta el dispatcher, catálogo de kinds y todos los consumers que invocan
 * `RecordInAppAsync(category:)`). Mientras no se haga, la UI usa los nombres
 * reales del enum backend.
 */
export type NotificationCategory =
  | 'AccountSecurity'
  | 'DocumentsAndSignatures'
  | 'StorageAndQuota'
  | 'Billing'
  | 'Collaboration'
  | 'Reminders'
  | 'ClientRequests'
  | 'Calendar';

/** Canales del enum `NotificationChannel` del backend. */
export type NotificationChannel = 'InApp' | 'Email' | 'Sms' | 'Push';

/** Una celda de la matriz Categoría × Canal. */
export interface NotificationPreference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  /** Mandatorio (D2): la celda no se puede apagar. UI muestra toggle on + lock icon. */
  locked: boolean;
}

/** Request de PUT /notifications/preferences — un solo cambio de celda. */
export interface SetNotificationPreferenceRequest {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}
