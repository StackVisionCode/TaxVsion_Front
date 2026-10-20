import { HttpErrorResponse } from '@angular/common/http';
import { toApiError } from '@core/models/api-error.model';

export function notificationResourceError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 403) {
      return 'You no longer have access to this item.';
    }
    if (error.status === 404) {
      return 'This item no longer exists.';
    }
  }
  return toApiError(error).message;
}
