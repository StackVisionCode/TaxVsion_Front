export interface ValidationIssue {
  code: string;
  path: string;
  componentId?: string | null;
  rowId?: string | null;
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  isValid: boolean;
}

export function report(issues: ValidationIssue[]): ValidationReport {
  return { issues, isValid: issues.length === 0 };
}

export function issue(
  code: string,
  path: string,
  componentId: string | null = null,
  rowId: string | null = null,
  message = issueMessage(code),
): ValidationIssue {
  return { code, path, componentId, rowId, message };
}

export function issueMessage(code: string): string {
  return ISSUE_MESSAGES[code] ?? 'The form contains an invalid value.';
}

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  'answer.required': 'A required answer is missing.',
  'answer.type_mismatch': 'The answer does not match the field type.',
  'answer.looks_like_tax_identifier':
    'For your security, enter tax IDs only in the dedicated field.',
  'answer.looks_like_card_number': 'Payment card numbers cannot be entered in forms.',
  'condition.forward_reference': 'Conditions can reference only earlier fields.',
  'condition.value_invalid': 'The condition value is invalid.',
  'richtext.invalid_link': 'Only HTTPS links are allowed.',
};
