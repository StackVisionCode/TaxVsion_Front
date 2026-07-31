import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { EmployeeDirectoryEntry } from './chat.model';

/**
 * Cliente HTTP del directorio de Communication (`/communication/directory`) — solo
 * empleados: `/directory/customers` devuelve `customerId`, no `userId` (el id que pide
 * `chat.conversation.start_direct`), y no hay endpoint que resuelva ese mapeo por HTTP,
 * así que "nueva conversación" es solo con compañeros de equipo por ahora.
 */
@Injectable({ providedIn: 'root' })
export class ChatDirectoryService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/communication/directory`;

  searchEmployees(term: string, limit = 10): Observable<EmployeeDirectoryEntry[]> {
    const params = new HttpParams().set('q', term).set('limit', limit);
    return this.http.get<EmployeeDirectoryEntry[]>(`${this.base}/employees`, { params });
  }
}
