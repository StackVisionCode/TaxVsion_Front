import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CalendarEvent, OccurrenceResponse, toCalendarEvent } from './calendar.model';

/**
 * Cliente HTTP del mini calendario (Calendar.Api vía `/calendar`). Solo lectura por
 * rango: el widget del dashboard no crea ni edita citas (eso vive en el módulo de
 * agenda). Requiere el permiso `calendar.read` — sin él la llamada devuelve 403 y el
 * widget muestra el mes vacío sin romper el dashboard.
 */
@Injectable({ providedIn: 'root' })
export class DashboardCalendarService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /**
   * GET /calendar/appointments?from=&to= — las ocurrencias del rango (las series
   * recurrentes vienen ya expandidas por el backend).
   */
  range(from: Date, to: Date): Observable<CalendarEvent[]> {
    const params = new HttpParams().set('from', from.toISOString()).set('to', to.toISOString());
    return this.http
      .get<OccurrenceResponse[]>(this.api.tenantUrl('/calendar/appointments'), { params })
      .pipe(map(items => items.map(toCalendarEvent)));
  }
}
