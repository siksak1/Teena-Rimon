/** Raised when a PDF cannot be parsed; `message` is shown to the user (Hebrew). */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
