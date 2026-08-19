import { HttpErrorResponse } from '@angular/common/http';

/** RFC 9457, as the API emits it. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string[]>;
}

/**
 * Pulls field-level validation errors out of a failed response.
 *
 * The API deliberately returns `{ "title": ["Title must be at least..."] }` rather than a
 * flat list of sentences, so the form can put each message against the input that caused
 * it. A message the user cannot see next to the field they got wrong is not actionable.
 */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof HttpErrorResponse)) {
    return {};
  }

  const problem = error.error as ProblemDetails | null;
  const errors = problem?.errors;

  if (!errors) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(errors).map(([field, messages]) => [field, messages[0] ?? 'Invalid value.']),
  );
}

export function messageFrom(error: unknown, fallback = 'Something went wrong.'): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  const problem = error.error as ProblemDetails | null;

  if (error.status === 0) {
    return 'The server could not be reached. Check that the API is running.';
  }
  if (error.status === 403) {
    return problem?.detail ?? 'You do not have access to do that.';
  }

  return problem?.detail ?? problem?.title ?? fallback;
}
