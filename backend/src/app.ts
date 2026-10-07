import cors from "cors";
import express from "express";
import multer from "multer";
import { extractInvoices } from "../../core/src/extract.js";
import { ExtractionError } from "../../core/src/errors.js";

const app = express();

// Lambda-friendly limits: a Function URL request (both files, base64-encoded)
// must stay under 6 MB, so cap each PDF at 2 MB.
const MAX_PDF_BYTES = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    if (ok) {
      cb(null, true);
      return;
    }
    cb(new Error("ניתן להעלות קובצי PDF בלבד"));
  },
});

/**
 * In AWS, CloudFront adds a secret header to every request it forwards.
 * Rejecting requests without it blocks direct calls to the Lambda Function URL.
 * Unset locally, so the check is skipped in development.
 */
const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;
if (originVerifySecret) {
  app.use((req, res, next) => {
    if (req.get("x-origin-verify") !== originVerifySecret) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
  });
});

/**
 * POST /api/extract
 * multipart fields: trInvoice (Teena-Rimon draft), supplierInvoice (PDF files)
 * Parses both PDFs deterministically and returns the structured lines —
 * reconciliation runs in the browser.
 */
app.post(
  "/api/extract",
  upload.fields([
    { name: "trInvoice", maxCount: 1 },
    { name: "supplierInvoice", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files as
        | { [field: string]: Express.Multer.File[] }
        | undefined;

      const trFile = files?.trInvoice?.[0];
      const supplierFile = files?.supplierInvoice?.[0];

      if (!trFile || !supplierFile) {
        res.status(400).json({
          error: "יש להעלות את שני הקבצים: חשבונית תאנה ורימון וחשבונית הספק.",
        });
        return;
      }

      const result = await extractInvoices({
        trPdf: new Uint8Array(trFile.buffer),
        supplierPdf: new Uint8Array(supplierFile.buffer),
        trFileName: decodeName(trFile.originalname),
        supplierFileName: decodeName(supplierFile.originalname),
        parseMode: "server",
      });

      res.json(result);
    } catch (err) {
      if (err instanceof ExtractionError) {
        res.status(422).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : "Extraction failed";
      console.error("[extract]", message);
      res.status(500).json({ error: "שגיאה בקריאת הקבצים" });
    }
  },
);

// Multer / general error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? `כל קובץ PDF מוגבל ל-${MAX_PDF_BYTES / 1024 / 1024} MB.`
        : err.message;
    res.status(400).json({ error: message });
  },
);

/** Multer decodes multipart file names as latin1; Hebrew names arrive mangled. */
function decodeName(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

export { app };
