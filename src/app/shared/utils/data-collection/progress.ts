import { evaluateCondition, isAnswered } from './conditions';
import { createDefinitionIndex } from './definition-index';
import type { FormAnswers } from './form-answers.model';
import type { FormDefinition } from './form-definition.model';
import { readRows, type VisibilityMap } from './visibility';

export interface FormProgress {
  required: number;
  answered: number;
}

export function calculateProgress(
  definition: FormDefinition,
  answers: FormAnswers,
  visibility: VisibilityMap,
): FormProgress {
  const index = createDefinitionIndex(definition);
  let required = 0;
  let answered = 0;
  for (const page of definition.pages ?? []) {
    if (!visibility.isVisible(page.id)) continue;
    for (const section of page.sections ?? []) {
      if (!visibility.isVisible(section.id)) continue;
      const rows = section.repeat == null ? [null] : readRows(answers, section.id);
      for (const row of rows) {
        for (const component of section.components ?? []) {
          const context = index.components.get(component.id);
          const visible =
            row == null
              ? visibility.isVisible(component.id)
              : visibility.isRowVisible(component.id, row.rowId);
          if (!visible || context?.componentType?.kind !== 'input') continue;
          const effectiveRequired =
            component.required === true ||
            (component.requiredWhen != null &&
              evaluateCondition(
                component.requiredWhen,
                answers,
                index,
                visibility,
                row?.rowId ?? null,
                row?.values ?? null,
              ));
          if (!effectiveRequired) continue;
          required++;
          const value = row == null ? answers.values[component.id] : row.values[component.id];
          if (
            component.type === 'checkbox' && component.required === true
              ? value === true
              : isAnswered(value, component.type)
          )
            answered++;
        }
      }
    }
  }
  return { required, answered };
}
