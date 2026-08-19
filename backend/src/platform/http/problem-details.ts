/**
 * RFC 9457 problem details. One error shape for the whole API, so a client never has to
 * guess which of three formats it received.
 */
export interface ProblemDetails {
  /** A URI reference identifying the problem type. `about:blank` when the status says it all. */
  type: string;
  /** Short, human-readable summary. Stable for a given type — safe to match on. */
  title: string;
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** The path that produced it. */
  instance?: string;
  /** Field-level validation failures, keyed by property path. */
  errors?: Record<string, string[]>;
}
