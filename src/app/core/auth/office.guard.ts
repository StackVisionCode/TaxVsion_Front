import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { of, catchError, map, tap } from 'rxjs';
import { environment } from '@env/environment';
import { ApiConfigService } from '@core/config/api-config.service';
import { TenantResolutionService } from './tenant-resolution.service';

const OFFICE_OK_PREFIX = 'office_ok:';

/**
 * En prod, un subdominio de tenant que NO corresponde a ninguna oficina (tecleado al azar)
 * no debe mostrar el login. Resuelve el slug del Host y, si no hay oficina viva, manda al
 * buscador canónico (app.<baseDomain>/find-office). Fail-open: si el chequeo falla (endpoint
 * caído), deja pasar para no bloquear a usuarios legítimos — el backend igual rechaza el login
 * de un tenant inexistente.
 */
export const officeGuard: CanActivateFn = () => {
  // En dev un único gateway atiende todo por localhost: no hay slug de Host que validar.
  if (!environment.production) {
    return true;
  }

  const slug = inject(ApiConfigService).slug();
  // Sin slug (app/api/www/admin/apex): lo maneja el portal / find-office, no se bloquea.
  if (!slug) {
    return true;
  }

  // Ya validado en esta sesión: no re-chequear en cada visita al login.
  if (readOfficeOk(slug)) {
    return true;
  }

  return inject(TenantResolutionService)
    .officeExists(slug)
    .pipe(
      tap(exists => exists && writeOfficeOk(slug)),
      map(exists => {
        if (exists) {
          return true;
        }
        window.location.href = `https://app.${environment.baseDomain}/find-office`;
        return false;
      }),
      catchError(() => of(true)),
    );
};

function readOfficeOk(slug: string): boolean {
  try {
    return sessionStorage.getItem(OFFICE_OK_PREFIX + slug) === '1';
  } catch {
    return false;
  }
}

function writeOfficeOk(slug: string): void {
  try {
    sessionStorage.setItem(OFFICE_OK_PREFIX + slug, '1');
  } catch {
    // Sin sessionStorage (modo privado / bloqueado): igual funciona, solo re-chequea.
  }
}
