import { evaluateCondition } from './conditions';
import type { DataCollectionLimits } from './data-collection-limits';
import { createDefinitionIndex } from './definition-index';
import type { FormAnswers, RepeaterRow } from './form-answers.model';
import type { FormDefinition, FormSection } from './form-definition.model';
import { isRecord } from './properties';

export class VisibilityMap {
  private readonly visible = new Set<string>();
  private readonly rowVisibility = new Map<string, boolean>();
  private readonly rowCounts = new Map<string, number>();

  get visibleIds(): readonly string[] {
    return [...this.visible];
  }

  isVisible(id: string): boolean {
    return this.visible.has(id);
  }

  isRowVisible(componentId: string, rowId: string): boolean {
    return this.rowVisibility.get(`${componentId}\u0000${rowId}`) === true;
  }

  rowCount(sectionId: string, answers: FormAnswers): number {
    if (!this.isVisible(sectionId)) return 0;
    return this.rowCounts.get(sectionId) ?? readRows(answers, sectionId).length;
  }

  markVisible(id: string): void {
    this.visible.add(id);
  }

  setRowVisibility(componentId: string, rowId: string, visible: boolean): void {
    this.rowVisibility.set(`${componentId}\u0000${rowId}`, visible);
  }

  setRowCount(sectionId: string, count: number): void {
    this.rowCounts.set(sectionId, count);
  }
}

export function evaluateVisibility(
  definition: FormDefinition,
  answers: FormAnswers,
  limits: DataCollectionLimits,
): VisibilityMap {
  const index = createDefinitionIndex(definition);
  const visibility = new VisibilityMap();
  for (const page of definition.pages ?? []) {
    if (!evaluateCondition(page.visibleWhen, answers, index, visibility)) continue;
    visibility.markVisible(page.id);
    for (const section of page.sections ?? []) {
      if (!evaluateCondition(section.visibleWhen, answers, index, visibility)) continue;
      visibility.markVisible(section.id);
      if (section.repeat == null) {
        evaluateComponents(section, answers, index, visibility, null);
        continue;
      }
      const rows = readRows(answers, section.id);
      visibility.setRowCount(section.id, rows.length);
      rows
        .slice(0, Math.min(section.repeat.maxRows, limits.maxRepeaterRows))
        .forEach((row) => evaluateComponents(section, answers, index, visibility, row));
    }
  }
  return visibility;
}

function evaluateComponents(
  section: FormSection,
  answers: FormAnswers,
  index: ReturnType<typeof createDefinitionIndex>,
  visibility: VisibilityMap,
  row: RepeaterRow | null,
): void {
  for (const component of section.components ?? []) {
    const visible = evaluateCondition(
      component.visibleWhen,
      answers,
      index,
      visibility,
      row?.rowId ?? null,
      row?.values ?? null,
    );
    if (row != null) visibility.setRowVisibility(component.id, row.rowId, visible);
    if (visible) visibility.markVisible(component.id);
  }
}

export function readRows(answers: FormAnswers, sectionId: string): RepeaterRow[] {
  const value = answers.values?.[sectionId];
  if (!isRecord(value) || !Array.isArray(value['rows'])) return [];
  return value['rows'].filter(isRecord).map((row) => ({
    rowId: typeof row['rowId'] === 'string' ? row['rowId'] : '',
    values: isRecord(row['values']) ? row['values'] : {},
  }));
}

export function removeHiddenAnswers(
  definition: FormDefinition,
  answers: FormAnswers,
  visibility: VisibilityMap,
): FormAnswers {
  const values: Record<string, unknown> = {};
  for (const page of definition.pages ?? []) {
    if (!visibility.isVisible(page.id)) continue;
    for (const section of page.sections ?? []) {
      if (!visibility.isVisible(section.id)) continue;
      if (section.repeat == null) {
        for (const component of section.components ?? []) {
          if (
            visibility.isVisible(component.id) &&
            Object.prototype.hasOwnProperty.call(answers.values, component.id)
          )
            values[component.id] = structuredClone(answers.values[component.id]);
        }
      } else {
        values[section.id] = {
          rows: readRows(answers, section.id).map((row) => ({
            rowId: row.rowId,
            values: Object.fromEntries(
              (section.components ?? [])
                .filter(
                  (component) =>
                    visibility.isRowVisible(component.id, row.rowId) &&
                    Object.prototype.hasOwnProperty.call(row.values, component.id),
                )
                .map((component) => [component.id, structuredClone(row.values[component.id])]),
            ),
          })),
        };
      }
    }
  }
  return { schemaVersion: answers.schemaVersion, values };
}
