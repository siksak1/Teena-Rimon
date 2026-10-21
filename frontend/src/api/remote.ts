import { ExtractionError } from "@core/errors.js";
import type { SupplierInvoice } from "@core/model.js";
import { readProfile, type SupplierProfile } from "@core/parsers/profile.js";
import type { AiRequest, RemoteSupport } from "@core/remote.js";

/** The AI backend (infra: the Function URL), set at build time by scripts/release.sh. */
const ENDPOINT = import.meta.env.VITE_AI_ENDPOINT as string | undefined;

/** The customer's secret URL token: the first segment of the page's path. Dev servers have none. */
function customerToken(): string {
  const first = location.pathname.split("/").find(Boolean);
  return first && /^[a-z0-9-]{8,80}$/.test(first) ? first : "dev-local-token";
}

function url(path: string): string {
  return `${ENDPOINT!.replace(/\/+$/, "")}/${path}`;
}

/** Backend support for this build, or undefined when the customer's config leaves the AI off or no endpoint was built in. */
export function browserRemoteSupport(enabled: boolean, onAiStart?: () => void): RemoteSupport | undefined {
  if (!enabled || !ENDPOINT) return undefined;
  const headers = { "x-customer-token": customerToken() };
  return {
    async profiles(vatIds) {
      if (vatIds.length === 0) return [];
      const res = await fetch(url(`profiles?vat=${vatIds.join(",")}`), { headers, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) return [];
      const body = (await res.json()) as { profiles?: unknown[] };
      return (body.profiles ?? []).flatMap((p) => {
        const profile = readProfile(p);
        return profile ? [profile as SupplierProfile] : [];
      });
    },

    async readWithAi(request: AiRequest): Promise<SupplierInvoice> {
      let res: Response;
      try {
        res = await fetch(url("parse"), {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          body: JSON.stringify({
            pdf: toBase64(request.pdf),
            fileName: request.fileName,
            scanned: request.scanned,
            rows: request.rows,
            vatHint: request.vatHint,
          }),
        });
      } catch {
        throw unavailable();
      }
      if (res.status === 429) {
        throw new ExtractionError(
          "הגעתם למספר הקריאות היומי בעזרת AI. ניתן לנסות שוב מחר, או לפנות לתמיכה",
          "AI_RATE_LIMITED",
        );
      }
      if (res.status === 422) {
        throw new ExtractionError(
          `לא ניתן לקרוא את חשבונית הספק בקובץ "${request.fileName}", גם לא בעזרת AI. נא לשלוח אותה לתמיכה`,
          "AI_UNREADABLE",
        );
      }
      if (!res.ok) throw unavailable();
      const body = (await res.json()) as { invoice: SupplierInvoice };
      return body.invoice;
    },

    onAiStart,
  };
}

function unavailable(): ExtractionError {
  return new ExtractionError(
    "לא ניתן לקרוא את חשבונית הספק בדפדפן, ושירות הקריאה בעזרת AI אינו זמין כרגע. נסו שוב בעוד כמה דקות",
    "AI_UNAVAILABLE",
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
