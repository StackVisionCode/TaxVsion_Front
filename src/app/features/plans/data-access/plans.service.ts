import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { Plan } from './plan.model';

/** Acceso HTTP al catálogo de planes. Endpoint público del gateway (no requiere sesión). */
@Injectable()
export class PlansService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  list(): Observable<Plan[]> {
    return this.http.get<Plan[]>(`${this.base}/plans`);
  }
}
