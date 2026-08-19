import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { Plan } from './plan.model';

/** Acceso HTTP al catálogo de planes. Endpoint público del gateway (no requiere sesión). */
@Injectable()
export class PlansService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  // Sistema: /plans es el catálogo de precios (público, pre-tenant).
  private get base(): string {
    return this.api.systemBase();
  }

  list(): Observable<Plan[]> {
    return this.http.get<Plan[]>(`${this.base}/plans`);
  }
}
