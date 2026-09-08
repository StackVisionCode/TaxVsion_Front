import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CustomerImportAttempt, CustomerImportRow, DuplicateStrategy, toImportRow } from './client-imports.model';

/**
 * Cliente HTTP fino sobre CustomerImportsController (`customers/imports`, Customer.Api vía
 * Gateway). Todos los endpoints exigen rol TenantAdmin en el backend: un TenantEmployee
 * recibe 403 y la UI lo muestra tal cual.
 */
@Injectable({ providedIn: 'root' })
export class ClientImportsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/customers/imports');
  }

  /**
   * POST /customers/imports — multipart/form-data. El controller recibe el archivo como
   * `IFormFile file` y el resto en `[FromForm] StartCustomerImportRequest`, cuyo único
   * campo es `Strategy`; NO hay mapeo de columnas ni previsualización en el contrato.
   *
   * El header `Idempotency-Key` es obligatorio (400 `Import.IdempotencyKey` sin él) y el
   * handler lo usa para replay: reintentar con la MISMA clave devuelve el intento ya
   * creado en vez de duplicar la importación, así que el llamador debe conservarla
   * mientras siga siendo el mismo archivo.
   *
   * Ojo: no se fija Content-Type a mano — el navegador tiene que poner el boundary del
   * multipart, y sobreescribirlo rompe el binding del form en ASP.NET.
   */
  start(file: File, strategy: DuplicateStrategy, idempotencyKey: string): Observable<CustomerImportAttempt> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('Strategy', strategy);
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<CustomerImportAttempt>(this.base, form, { headers });
  }

  /** GET /customers/imports/{id} — estado y contadores de una importación (fuente del polling). */
  getById(id: string): Observable<CustomerImportAttempt> {
    return this.http.get<CustomerImportAttempt>(`${this.base}/${id}`);
  }

  /**
   * GET /customers/imports — historial. Devuelve un array plano, sin total ni metadatos de
   * paginación, así que el "hay más páginas" se deduce de si vino la página completa.
   */
  search(page: number, size: number): Observable<CustomerImportAttempt[]> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<CustomerImportAttempt[]>(this.base, { params });
  }

  /** POST /customers/imports/{id}/cancel — 202 sin cuerpo. 400 `Import.AlreadyTerminal` si ya terminó. */
  cancel(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/cancel`, {});
  }

  /**
   * GET /customers/imports/{id}/report?format=json — informe fila por fila.
   * El controller lo serializa a mano (PascalCase, enum numérico), de ahí el mapeo con
   * {@link toImportRow}. Es un stream sin paginar: llegan TODAS las filas del intento.
   */
  getReportRows(id: string): Observable<CustomerImportRow[]> {
    const params = new HttpParams().set('format', 'json');
    return this.http
      .get<unknown[]>(`${this.base}/${id}/report`, { params })
      .pipe(map(rows => (Array.isArray(rows) ? rows.map(toImportRow) : [])));
  }

  /**
   * GET /customers/imports/{id}/report?format=csv — el mismo informe como CSV descargable.
   * Va por HttpClient (y no por un `<a href>`) porque el endpoint exige el JWT del tenant:
   * un link plano se iría sin Authorization y respondería 401.
   */
  downloadReportCsv(id: string): Observable<Blob> {
    const params = new HttpParams().set('format', 'csv');
    return this.http.get(`${this.base}/${id}/report`, { params, responseType: 'blob' });
  }

  /**
   * GET /customers/imports/template — plantilla CSV con los encabezados exactos que espera
   * el parser, más dos filas de ejemplo. También requiere autenticación (el `[Authorize]`
   * está a nivel de controller), así que se descarga como blob y se sirve con un object URL.
   */
  downloadTemplate(): Observable<Blob> {
    return this.http.get(`${this.base}/template`, { responseType: 'blob' });
  }
}
