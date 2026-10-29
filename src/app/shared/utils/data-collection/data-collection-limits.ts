export interface DataCollectionLimits {
  maxDefinitionBytes: number;
  maxPages: number;
  maxSectionsPerPage: number;
  maxComponentsPerSection: number;
  maxComponents: number;
  maxOptionsPerChoice: number;
  maxLabelLength: number;
  maxHelpTextLength: number;
  maxParagraphLength: number;
  maxConditionNodes: number;
  maxConditionDepth: number;
  maxRepeaterRows: number;
  maxNestingDepth: number;
  maxAnswersBytes: number;
  maxFilesPerField: number;
  maxFilesPerSubmission: number;
  maxSubmissionTotalBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_DATA_COLLECTION_LIMITS: Readonly<DataCollectionLimits> = Object.freeze({
  maxDefinitionBytes: 524_288,
  maxPages: 50,
  maxSectionsPerPage: 20,
  maxComponentsPerSection: 60,
  maxComponents: 600,
  maxOptionsPerChoice: 200,
  maxLabelLength: 300,
  maxHelpTextLength: 2_000,
  maxParagraphLength: 8_000,
  maxConditionNodes: 50,
  maxConditionDepth: 5,
  maxRepeaterRows: 50,
  maxNestingDepth: 1,
  maxAnswersBytes: 1_048_576,
  maxFilesPerField: 20,
  maxFilesPerSubmission: 200,
  maxSubmissionTotalBytes: 262_144_000,
  maxFileBytes: 26_214_400,
});
