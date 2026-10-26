import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import type {
  MappingSensitivity,
  MappingTargetStatus,
  MappingTargetType,
} from '@shared/utils/data-collection/mapping.model';
import { Observable, map } from 'rxjs';
import type {
  FormMappingCatalogResponse,
  FormMappingTargetResponse,
  MappingCatalog,
} from './mapping-catalog.model';

@Injectable({ providedIn: 'root' })
export class MappingCatalogService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  get(): Observable<MappingCatalog> {
    return this.http
      .get<FormMappingCatalogResponse>(this.api.tenantUrl('/tasks/forms/mapping-catalog'))
      .pipe(map(toMappingCatalog));
  }
}

/**
 * Pasa la respuesta al modelo del engine TS. Los permisos van vacíos porque el backend ya quitó lo
 * que el usuario no puede mapear; así `validateMappings` no duplica esa decisión.
 */
export function toMappingCatalog(response: FormMappingCatalogResponse): MappingCatalog {
  return {
    catalogVersion: response.catalogVersion,
    operations: (response.operations ?? []).map((operation) => ({
      name: operation.name,
      requiredPermissions: [],
      requiresTenantAdmin: false,
      discriminatorTargetKey: operation.discriminatorTargetKey ?? null,
      configTargets: { ...(operation.configTargets ?? {}) },
    })),
    targets: (response.targets ?? []).map(toTarget),
  };
}

function toTarget(target: FormMappingTargetResponse): MappingCatalog['targets'][number] {
  return {
    targetKey: target.targetKey,
    domain: target.domain,
    entity: target.entity,
    displayName: target.displayName,
    dataType: camel(target.dataType) as MappingTargetType,
    sensitivity: camel(target.sensitivity) as MappingSensitivity,
    status: camel(target.status) as MappingTargetStatus,
    operations: [...(target.operations ?? [])],
    requiredFor: (target.requiredFor ?? []).map((item) => ({
      operation: item.operation,
      kind: item.kind ?? null,
    })),
    requiredPermissions: [],
    requiresTenantAdmin: false,
    maxLength: target.maxLength ?? null,
    enumValues: [...(target.enumValues ?? [])],
    pastOnly: target.pastOnly === true,
    fields: (target.fields ?? []).map((field) => ({
      name: field.name,
      dataType: camel(field.dataType) as MappingTargetType,
      maxLength: field.maxLength ?? null,
      required: field.required === true,
      compatibleComponentTypes: [...(field.compatibleComponentTypes ?? [])],
    })),
    compatibleComponentTypes: [...(target.compatibleComponentTypes ?? [])],
  };
}

// "TaxId" → "taxId": el engine TS usa camelCase para los mismos enums.
function camel(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}
