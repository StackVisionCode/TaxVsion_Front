import type { Condition } from '@shared/utils/data-collection/conditions';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import type { ComponentOption } from './mapping-compatibility';

/** Dónde se usa el valor de una opción: borrarlo sin avisar rompería mapeo, condiciones o respuestas. */
export interface OptionUsage {
  mapped: boolean;
  conditions: string[];
}

/**
 * Valor nuevo que no choca con ninguno existente. Los valores son estables: reordenar o renombrar
 * una opción nunca los cambia (P-16: el optionMap y las condiciones apuntan al valor).
 */
export function nextOptionValue(options: readonly ComponentOption[]): string {
  const values = new Set(options.map((option) => option.value));
  let next =
    options.reduce((max, option) => {
      const match = /^option(\d+)$/.exec(option.value);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  while (values.has(`option${next}`)) next++;
  return `option${next}`;
}

export function optionUsage(definition: FormDefinition | null, componentId: string, value: string): OptionUsage {
  if (!definition) return { mapped: false, conditions: [] };
  const mapped = (definition.mappings ?? []).some(
    (mapping) =>
      mapping.componentId === componentId &&
      mapping.optionMap != null &&
      Object.prototype.hasOwnProperty.call(mapping.optionMap, value),
  );
  const conditions: string[] = [];
  const check = (condition: Condition | null | undefined, owner: string) => {
    if (usesOption(condition, componentId, value) && !conditions.includes(owner)) conditions.push(owner);
  };
  definition.pages.forEach((page, pageIndex) => {
    check(page.visibleWhen, page.title || `Page ${pageIndex + 1}`);
    for (const section of page.sections) {
      check(section.visibleWhen, section.title || 'Section');
      for (const component of section.components) {
        const label = component.label || component.type;
        check(component.visibleWhen, label);
        check(component.requiredWhen, label);
      }
    }
  });
  for (const action of definition.actions ?? []) check(action.condition, `Action ${action.key}`);
  return { mapped, conditions };
}

function usesOption(condition: Condition | null | undefined, componentId: string, value: string): boolean {
  if (!condition) return false;
  if (condition.field === componentId) {
    const target = condition.value;
    if (target === value || (Array.isArray(target) && target.includes(value))) return true;
  }
  return (
    [...(condition.all ?? []), ...(condition.any ?? [])].some((child) => usesOption(child, componentId, value)) ||
    usesOption(condition.not, componentId, value)
  );
}
