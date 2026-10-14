import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AccessCapability,
  AccessResourceType,
  CustomerAccessRuleView,
  SetDenyRuleRequest,
} from './customer-document-access.model';

// Normaliza enums del backend a las variantes PascalCase que la UI espera, aunque lleguen como
// número (int enum), lowercase, camelCase o con whitespace. Protege contra cualquier cambio de
// casing en la pipeline de serialización.
const RESOURCE_TYPE_ALIASES: Record<string, AccessResourceType> = {
  '1': 'Folder',
  '2': 'File',
  '3': 'TenantScope',
  folder: 'Folder',
  file: 'File',
  tenantscope: 'TenantScope',
  tenant_scope: 'TenantScope',
};

const CAPABILITY_ALIASES: Record<string, AccessCapability> = {
  '1': 'Visible',
  '2': 'Preview',
  '3': 'Download',
  '4': 'Upload',
  '5': 'Delete',
  '6': 'ShareExternal',
  visible: 'Visible',
  preview: 'Preview',
  download: 'Download',
  upload: 'Upload',
  delete: 'Delete',
  shareexternal: 'ShareExternal',
  share_external: 'ShareExternal',
};

function normalizeResourceType(raw: unknown): AccessResourceType {
  const key = String(raw ?? '')
    .toLowerCase()
    .trim();
  return RESOURCE_TYPE_ALIASES[key] ?? (raw as AccessResourceType);
}

function normalizeCapability(raw: unknown): AccessCapability {
  const key = String(raw ?? '')
    .toLowerCase()
    .trim();
  return CAPABILITY_ALIASES[key] ?? (raw as AccessCapability);
}

function normalizeRule(rule: CustomerAccessRuleView): CustomerAccessRuleView {
  return {
    ...rule,
    resourceType: normalizeResourceType(rule.resourceType),
    capability: normalizeCapability(rule.capability),
  };
}

/**
 * Cliente HTTP para las reglas deny per-item del portal de un cliente
 * (CloudStorage.Api `/storage/customer-access/{customerId}/rules`).
 */
@Injectable({ providedIn: 'root' })
export class CustomerDocumentAccessService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private rulesUrl(customerId: string): string {
    return this.api.tenantUrl(`/storage/customer-access/${customerId}/rules`);
  }

  list(customerId: string): Observable<CustomerAccessRuleView[]> {
    return this.http
      .get<CustomerAccessRuleView[]>(this.rulesUrl(customerId))
      .pipe(map((rules) => rules.map(normalizeRule)));
  }

  setDeny(customerId: string, request: SetDenyRuleRequest): Observable<CustomerAccessRuleView> {
    // El backend devuelve `SetDenyOverrideResponse { rule, created }`; aquí nos interesa solo el
    // rule (el store lo almacena como `CustomerAccessRuleView`). Desenvolver antes de normalizar
    // evita guardar el wrapper con los campos del rule en `undefined`.
    return this.http
      .post<{ rule: CustomerAccessRuleView; created: boolean }>(this.rulesUrl(customerId), request)
      .pipe(map((response) => normalizeRule(response.rule)));
  }

  clearDeny(
    customerId: string,
    resourceType: AccessResourceType,
    resourceId: string,
    capability: AccessCapability,
  ): Observable<void> {
    const params = new HttpParams()
      .set('resourceType', resourceType)
      .set('resourceId', resourceId)
      .set('capability', capability);
    return this.http.delete<void>(this.rulesUrl(customerId), { params });
  }
}
