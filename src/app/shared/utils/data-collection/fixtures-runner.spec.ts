import { describe, expect, it } from 'vitest';
import answersCases from './fixtures/v1/answers/cases.json';
import conditionsCases from './fixtures/v1/conditions/cases.json';
import manifest from './fixtures/v1/manifest.json';
import mappingsCases from './fixtures/v1/mappings/cases.json';
import progressCases from './fixtures/v1/progress/cases.json';
import structureCases from './fixtures/v1/structure/cases.json';
import { validateAnswers } from './answers-validator';
import { DEFAULT_DATA_COLLECTION_LIMITS } from './data-collection-limits';
import { FormEngine } from './form-engine';
import type { FormAnswers } from './form-answers.model';
import type { MappingCatalogSnapshot, PublisherCapabilities } from './mapping.model';
import { validateMappings } from './mapping-validator';
import { calculateProgress } from './progress';
import { validateForPublish } from './structure-validator';
import type { ValidationIssue } from './validation';
import { evaluateVisibility } from './visibility';

interface FixtureExpected {
  valid: boolean;
  issues: Array<{ code: string; path: string }>;
  visible?: string[];
  progress?: { required: number; answered: number };
}

interface FixtureCase {
  name: string;
  mode: 'structure' | 'draft' | 'submit' | 'visibility' | 'progress' | 'mappings';
  definition: unknown;
  answers?: unknown;
  catalog?: MappingCatalogSnapshot;
  capabilities?: PublisherCapabilities;
  expected: FixtureExpected;
}

const cases = [
  structureCases,
  answersCases,
  conditionsCases,
  progressCases,
  mappingsCases,
].flat() as unknown as FixtureCase[];

describe('data collection engine fixture contract v1', () => {
  it('loads the exact fixture manifest and all 155 cases', () => {
    expect(manifest.fixtureSetVersion).toBe(1);
    expect(manifest.files).toEqual([
      'structure/cases.json',
      'answers/cases.json',
      'conditions/cases.json',
      'progress/cases.json',
      'mappings/cases.json',
    ]);
    expect(cases).toHaveLength(155);
  });

  it.each(cases)('$name', (fixture) => {
    // Igual que el runner .NET: definición y respuestas pasan por el parse estricto, no por un cast.
    const engine = new FormEngine(DEFAULT_DATA_COLLECTION_LIMITS);
    const parsedDefinition = engine.parseDefinition(JSON.stringify(fixture.definition));
    expect(parsedDefinition.isSuccess).toBe(true);
    if (!parsedDefinition.isSuccess) return;
    const definition = parsedDefinition.value;
    let answers: FormAnswers = { schemaVersion: 1, values: {} };
    if (fixture.mode !== 'structure' && fixture.mode !== 'mappings') {
      const parsedAnswers = engine.parseAnswers(JSON.stringify(fixture.answers ?? answers));
      expect(parsedAnswers.isSuccess).toBe(true);
      if (!parsedAnswers.isSuccess) return;
      answers = parsedAnswers.value;
    }
    const visibility =
      fixture.mode === 'structure' || fixture.mode === 'mappings'
        ? null
        : evaluateVisibility(definition, answers, DEFAULT_DATA_COLLECTION_LIMITS);
    let issues: ValidationIssue[];
    let progress: ReturnType<typeof calculateProgress> | null = null;

    if (fixture.mode === 'structure')
      issues = validateForPublish(definition, DEFAULT_DATA_COLLECTION_LIMITS).issues;
    else if (fixture.mode === 'mappings') {
      expect(fixture.catalog).toBeDefined();
      expect(fixture.capabilities).toBeDefined();
      issues = validateMappings(definition, fixture.catalog!, fixture.capabilities!).issues;
    } else {
      issues = validateAnswers(
        definition,
        answers,
        visibility!,
        fixture.mode === 'submit' ? 'submit' : 'draft',
        DEFAULT_DATA_COLLECTION_LIMITS,
      ).issues;
      if (fixture.mode === 'progress')
        progress = calculateProgress(definition, answers, visibility!);
    }

    expect(issues.length === 0).toBe(fixture.expected.valid);
    expect(issueKeys(issues)).toEqual(issueKeys(fixture.expected.issues));
    if (fixture.expected.visible != null)
      expect([...visibility!.visibleIds].sort()).toEqual([...fixture.expected.visible].sort());
    if (fixture.expected.progress != null) expect(progress).toEqual(fixture.expected.progress);
  });
});

function issueKeys(issues: Array<Pick<ValidationIssue, 'code' | 'path'>>): string[] {
  return [...new Set(issues.map((item) => `${item.code}\u0000${item.path}`))].sort();
}
