import { browserFamily, posthogBody, type AnalyticsContext, type AnalyticsEvent } from "@core/analytics.js";
import customer from "@customer-config";

/** PostHog Cloud EU project key — public by design (it can only submit events). */
const POSTHOG_KEY = "phc_npLKADDfrAERnccGFYqsRA9VxAXwzkMSbyyE5KYCM5Ny";
/** The only host the app ever contacts; the CSP's connect-src allows exactly this origin. */
const POSTHOG_CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";

export const analyticsContext: AnalyticsContext = {
  config: customer,
  appVersion: `${__APP_VERSION__}+${__APP_COMMIT__}`,
  browser: browserFamily(navigator.userAgent),
};

/**
 * Send one usage event (counts only — see core/src/analytics.ts). Fire and
 * forget: a blocked or failing analytics host never affects the app. The
 * request carries no cookies and no Referer, so the page's secret URL path is
 * never sent. Dev servers only log the payload.
 */
export function track(e: AnalyticsEvent): void {
  const body = posthogBody(POSTHOG_KEY, e);
  if (import.meta.env.DEV) {
    console.info("[analytics] not sent from the dev server:", body);
    return;
  }
  try {
    fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // e.g. blocked by an extension or the network — ignore.
  }
}
