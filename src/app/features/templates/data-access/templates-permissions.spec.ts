import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { TemplatesPermissions } from './templates-permissions';

/** AccessStore falso: permisos y módulos del plan, con la misma semántica (anyOf = O). */
function setup(permissions: string[], modules: string[] = ['signatures', 'planner']): TemplatesPermissions {
  TestBed.resetTestingModule();
  const granted = new Set(permissions);
  const enabled = new Set(modules);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AccessStore,
        useValue: {
          can: (permission: string) => granted.has(permission),
          canUse: (req: AccessRequirement) =>
            (req.module === null || enabled.has(req.module)) && req.anyOf.some(p => granted.has(p)),
        },
      },
    ],
  });
  return TestBed.inject(TemplatesPermissions);
}

describe('TemplatesPermissions', () => {
  it('separates viewing email templates from managing them', () => {
    const viewer = setup(['notification.template.view']);
    expect(viewer.canViewEmail()).toBe(true);
    expect(viewer.canManageEmail()).toBe(false);
  });

  it('lets a manager edit email templates', () => {
    const manager = setup(['notification.template.view', 'notification.template.manage']);
    expect(manager.canManageEmail()).toBe(true);
  });

  it('shows the signature card with any template authoring permission and the module', () => {
    expect(setup(['signature.template.update']).canUseSignatureTemplates()).toBe(true);
    expect(setup(['signature.request.read']).canUseSignatureTemplates()).toBe(false);
    expect(setup(['signature.template.create'], ['planner']).canUseSignatureTemplates()).toBe(false);
  });

  it('shows the task card with tasks.write or tasks.templates.manage and the planner module', () => {
    expect(setup(['tasks.write']).canUseTaskTemplates()).toBe(true);
    expect(setup(['tasks.templates.manage']).canUseTaskTemplates()).toBe(true);
    expect(setup(['tasks.read']).canUseTaskTemplates()).toBe(false);
    expect(setup(['tasks.write'], ['signatures']).canUseTaskTemplates()).toBe(false);
  });
});
