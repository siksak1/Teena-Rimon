import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { extractInvoices } from "./extract.js";

const PORT = Number(process.env.PORT) || 43124;
const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per PDF
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    if (ok) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are accepted"));
  },
});

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: process.env.NODE_ENV === "development" ? "mock" : "ai",
  });
});

/**
 * POST /api/extract
 * multipart fields: ourInvoice, supplierInvoice (PDF files)
 * Returns raw structured JSON for both invoices — no comparison here.
 */
app.post(
  "/api/extract",
  upload.fields([
    { name: "ourInvoice", maxCount: 1 },
    { name: "supplierInvoice", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files as
        | { [field: string]: Express.Multer.File[] }
        | undefined;

      const ourFile = files?.ourInvoice?.[0];
      const supplierFile = files?.supplierInvoice?.[0];

      if (!ourFile || !supplierFile) {
        res.status(400).json({
          error: "Both ourInvoice and supplierInvoice PDF files are required.",
        });
        return;
      }

      const result = await extractInvoices(
        ourFile.buffer,
        supplierFile.buffer,
        ourFile.originalname,
        supplierFile.originalname,
      );

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      console.error("[extract]", message);
      res.status(500).json({ error: message });
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
    res.status(400).json({ error: err.message });
  },
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Invoice extract API on http://0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV ?? "undefined"})`,
  );
});

/**
 * Lambda-ready export shape (optional).
 * Wrap with @vendia/serverless-express or similar when deploying.
 */
export { app };
