export type MappingTargetType =
  'string' | 'date' | 'email' | 'phone' | 'enum' | 'boolean' | 'address' | 'taxId' | 'collection';
export type MappingSensitivity = 'general' | 'personal' | 'restricted';
export type MappingTargetStatus = 'active' | 'deprecated' | 'retired';

export interface MappingRequirement {
  operation: string;
  kind?: string | null;
}

export interface MappingTargetField {
  name: string;
  dataType: MappingTargetType;
  maxLength?: number | null;
  required?: boolean;
}

export interface MappingTarget {
  targetKey: string;
  domain: string;
  entity: string;
  displayName: string;
  dataType: MappingTargetType;
  sensitivity: MappingSensitivity;
  status: MappingTargetStatus;
  operations: string[];
  requiredFor: MappingRequirement[];
  requiredPermissions: string[];
  requiresTenantAdmin: boolean;
  maxLength?: number | null;
  enumValues?: string[] | null;
  pastOnly?: boolean;
  fields?: MappingTargetField[] | null;
  targetSchemaVersion?: number;
}

export interface MappingOperation {
  name: string;
  requiredPermissions: string[];
  requiresTenantAdmin: boolean;
  discriminatorTargetKey?: string | null;
  configTargets: Record<string, string>;
}

export interface MappingCatalogSnapshot {
  catalogVersion: number;
  targets: MappingTarget[];
  operations: MappingOperation[];
}

export interface PublisherCapabilities {
  permissions: string[];
  isTenantAdmin: boolean;
}
