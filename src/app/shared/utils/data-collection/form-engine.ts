import { validateAnswers } from './answers-validator';
import {
  canonicalJson,
  sha256,
  type CanonicalDefinition,
  type CanonicalRuleSets,
} from './canonical-json';
import { evaluateCondition, type Condition } from './conditions';
import {
  DEFAULT_DATA_COLLECTION_LIMITS,
  type DataCollectionLimits,
} from './data-collection-limits';
import { createDefinitionIndex } from './definition-index';
import type { AnswersValidationMode, FormAnswers } from './form-answers.model';
import type { FormAction, FormDefinition, FormMapping } from './form-definition.model';
import { ISSUE_CODES } from './issue-codes';
import type { MappingCatalogSnapshot, PublisherCapabilities } from './mapping.model';
import { validateMappings } from './mapping-validator';
import { calculateProgress } from './progress';
import {
  FORM_ACTIONS_SCHEMA,
  FORM_ANSWERS_SCHEMA,
  FORM_DEFINITION_SCHEMA,
  FORM_MAPPINGS_SCHEMA,
  readStrictJson,
  type StrictJsonSchema,
} from './strict-json';
import { validateForDraft, validateForPublish } from './structure-validator';
import type { ValidationReport } from './validation';
import { evaluateVisibility, removeHiddenAnswers, type VisibilityMap } from './visibility';

export interface EngineError {
  code: string;
  message: string;
}

export type ParseResult<T> =
  { isSuccess: true; value: T } | { isSuccess: false; error: EngineError };

export class FormEngine {
  constructor(readonly limits: DataCollectionLimits = DEFAULT_DATA_COLLECTION_LIMITS) {}

  parseDefinition(json: string): ParseResult<FormDefinition> {
    return this.parse<FormDefinition>(
      json,
      FORM_DEFINITION_SCHEMA,
      this.limits.maxDefinitionBytes,
      ISSUE_CODES.definitionTooLarge,
      ISSUE_CODES.definitionInvalidJson,
    );
  }

  validateForDraft(definition: FormDefinition): ValidationReport {
    return validateForDraft(definition, this.limits);
  }

  validateForPublish(definition: FormDefinition): ValidationReport {
    return validateForPublish(definition, this.limits);
  }

  parseAnswers(json: string): ParseResult<FormAnswers> {
    return this.parse<FormAnswers>(
      json,
      FORM_ANSWERS_SCHEMA,
      this.limits.maxAnswersBytes,
      ISSUE_CODES.answersTooLarge,
      ISSUE_CODES.answersInvalidJson,
    );
  }

  evaluateVisibility(definition: FormDefinition, answers: FormAnswers): VisibilityMap {
    return evaluateVisibility(definition, answers, this.limits);
  }

  validateAnswers(
    definition: FormDefinition,
    answers: FormAnswers,
    mode: AnswersValidationMode,
    options: { pageId?: string } = {},
  ): ValidationReport {
    return validateAnswers(
      definition,
      answers,
      this.evaluateVisibility(definition, answers),
      mode,
      this.limits,
      options,
    );
  }

  removeHiddenAnswers(
    definition: FormDefinition,
    answers: FormAnswers,
    visibility: VisibilityMap,
  ): FormAnswers {
    return removeHiddenAnswers(definition, answers, visibility);
  }

  calculateProgress(
    definition: FormDefinition,
    answers: FormAnswers,
    visibility: VisibilityMap,
  ): ReturnType<typeof calculateProgress> {
    return calculateProgress(definition, answers, visibility);
  }

  /**
   * Forma canónica local (claves ordenadas). No es byte a byte la de .NET, que serializa desde el
   * modelo con valores por defecto y escapa no-ASCII: no comparar este hash con el del servidor.
   */
  canonicalize(definition: FormDefinition): CanonicalDefinition {
    const json = canonicalJson(definition);
    return { json, sha256: sha256(json) };
  }

  canonicalizeRuleSets(definition: FormDefinition): CanonicalRuleSets {
    const mappingSetJson = canonicalJson(definition.mappings ?? []);
    const actionSetJson = canonicalJson(definition.actions ?? []);
    return {
      mappingSetJson,
      actionSetJson,
      isEmpty: mappingSetJson === '[]' && actionSetJson === '[]',
    };
  }

  validateMappings(
    definition: FormDefinition,
    catalog: MappingCatalogSnapshot,
    capabilities: PublisherCapabilities,
  ): ValidationReport {
    return validateMappings(definition, catalog, capabilities);
  }

  parseRuleSets(
    mappingSetJson: string,
    actionSetJson: string,
  ): ParseResult<{ mappings: FormMapping[]; actions: FormAction[] }> {
    const mappings = this.parse<FormMapping[]>(
      mappingSetJson,
      FORM_MAPPINGS_SCHEMA,
      this.limits.maxDefinitionBytes,
      ISSUE_CODES.definitionTooLarge,
      ISSUE_CODES.definitionInvalidJson,
    );
    if (!mappings.isSuccess) return mappings;
    const actions = this.parse<FormAction[]>(
      actionSetJson,
      FORM_ACTIONS_SCHEMA,
      this.limits.maxDefinitionBytes,
      ISSUE_CODES.definitionTooLarge,
      ISSUE_CODES.definitionInvalidJson,
    );
    return actions.isSuccess
      ? { isSuccess: true, value: { mappings: mappings.value, actions: actions.value } }
      : actions;
  }

  evaluateCondition(
    definition: FormDefinition,
    answers: FormAnswers,
    condition: Condition | null | undefined,
  ): boolean {
    if (condition == null) return true;
    const visibility = this.evaluateVisibility(definition, answers);
    return evaluateCondition(condition, answers, createDefinitionIndex(definition), visibility);
  }

  // Mismo contrato que StrictJson de .NET: un JSON que el servidor rechaza tampoco pasa aquí.
  private parse<T>(
    json: string,
    schema: StrictJsonSchema,
    maxBytes: number,
    tooLargeCode: string,
    invalidCode: string,
  ): ParseResult<T> {
    if (json == null || new TextEncoder().encode(json).length > maxBytes)
      return failure(tooLargeCode, 'JSON payload exceeds the configured limit.');
    try {
      return { isSuccess: true, value: readStrictJson(json, schema) as T };
    } catch {
      return failure(invalidCode, 'JSON payload is invalid.');
    }
  }
}

function failure<T>(code: string, message: string): ParseResult<T> {
  return { isSuccess: false, error: { code, message } };
}
