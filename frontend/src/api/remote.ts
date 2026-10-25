import { ExtractionError } from "@core/errors.js";
import type { SupplierInvoice } from "@core/model.js";
import { readProfile, type SupplierProfile } from "@core/parsers/profile.js";
import type { AiRequest, RemoteSupport } from "@core/remote.js";

/** The AI backend: "/api/" on the site itself (infra), set at build time by scripts/release.sh; the dev backend's URL locally. */
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
        // No answer at all: the browser, an extension or the network stopped the request.
        throw navigator.onLine === false
          ? new ExtractionError(`${CANNOT_READ} ואין כרגע חיבור לאינטרנט. נסו שוב כשהחיבור יחזור`, "AI_BLOCKED")
          : new ExtractionError(
              `${CANNOT_READ}, והחיבור לשירות הקריאה בעזרת AI נחסם או נקטע לפני שהתקבלה תשובה. ` +
                "ייתכן שתוסף בדפדפן (כמו חוסם פרסומות), סינון אינטרנט, VPN או אנטי-וירוס חוסמים את הכתובת " +
                `${new URL(url(""), location.href).host}. נסו בחלון גלישה בסתר או ברשת אחרת, או פנו לתמיכה`,
              "AI_BLOCKED",
            );
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
      if (!res.ok) throw await failure(res);
      const body = (await res.json()) as { invoice: SupplierInvoice };
      return body.invoice;
    },

    onAiStart,
  };
}

const CANNOT_READ = "לא ניתן לקרוא את חשבונית הספק בדפדפן";

/** Why the backend (or CloudFront in front of it) refused; the HTTP status goes in the message for support. */
async function failure(res: Response): Promise<ExtractionError> {
  const error = await res
    .json()
    .then((b: { error?: unknown }) => (typeof b?.error === "string" ? b.error : null))
    .catch(() => null);
  const status = `(קוד ${res.status}${error ? ` ${error}` : ""})`;
  if (res.status === 504) {
    return new ExtractionError(
      `${CANNOT_READ}, והקריאה בעזרת AI ארכה יותר מדקה ולכן הופסקה ${status}. נסו שוב, ואם זה חוזר פנו לתמיכה`,
      "AI_TIMEOUT",
    );
  }
  if (res.status === 404 || res.status === 400 || res.status === 413) {
    const why =
      res.status === 404
        ? "שירות הקריאה בעזרת AI לא זיהה את הקישור הזה"
        : res.status === 413
          ? "הקובץ גדול מדי לשליחה לקריאה בעזרת AI"
          : "שירות הקריאה בעזרת AI דחה את הבקשה";
    return new ExtractionError(`${CANNOT_READ}, ו${why} ${status}. נא לפנות לתמיכה`, "AI_REJECTED");
  }
  return new ExtractionError(
    `${CANNOT_READ}, ושירות הקריאה בעזרת AI נכשל ${status}. נסו שוב בעוד כמה דקות, ואם זה חוזר פנו לתמיכה`,
    "AI_UNAVAILABLE",
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
