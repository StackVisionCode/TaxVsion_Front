export type AnswerValue = unknown;

export interface FormAnswers {
  schemaVersion: number;
  values: Record<string, AnswerValue>;
}

export interface RepeaterRows {
  rows: RepeaterRow[];
}

export interface RepeaterRow {
  rowId: string;
  values: Record<string, AnswerValue>;
}

export type AnswersValidationMode = 'draft' | 'submit';
