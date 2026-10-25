/**
 * Why extraction failed, as a fixed code. The message is for the user and
 * may contain file names; only the code is ever reported to analytics.
 */
export type ExtractionErrorCode =
  | "NOT_PDF"
  | "FILES_SWAPPED"
  | "OWN_DOC_NOT_RECOGNIZED"
  | "UNSUPPORTED_SUPPLIER"
  | "NO_LINES"
  | "SCAN_UNREADABLE"
  | "TEXT_LAYER_BROKEN"
  | "NOT_EXCEL"
  | "MISSING_COLUMN"
  | "AI_UNAVAILABLE"
  | "AI_BLOCKED"
  | "AI_TIMEOUT"
  | "AI_REJECTED"
  | "AI_RATE_LIMITED"
  | "AI_UNREADABLE";

/** Raised when a PDF or Excel file cannot be parsed; `message` is shown to the user (Hebrew). */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(message: string, code: ExtractionErrorCode) {
    super(message);
    this.code = code;
    this.name = "ExtractionError";
  }
}
