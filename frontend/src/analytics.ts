import { browserFamily, posthogBody, type AnalyticsContext, type AnalyticsEvent } from "@core/analytics.js";
import customer from "@customer-config";

/** PostHog Cloud EU project key — public by design (it can only submit events). */
const POSTHOG_KEY = "phc_npLKADDfrAERnccGFYqsRA9VxAXwzkMSbyyE5KYCM5Ny";
/** The only host the app ever contacts; the CSP's connect-src allows exactly this origin. */
const POSTHOG_CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";

const INTERNAL_KEY = "ledgermatch.internal";

/**
 * Opening the app with `#internal` marks this browser as ours, so our own
 * tests on prod can be filtered out in PostHog; `#external` clears the mark.
 * The hash never leaves the page, and is removed from the address bar.
 */
function internalBrowser(): boolean {
  try {
    const hash = location.hash;
    if (hash === "#internal") localStorage.setItem(INTERNAL_KEY, "1");
    if (hash === "#external") localStorage.removeItem(INTERNAL_KEY);
    if (hash === "#internal" || hash === "#external") {
      history.replaceState(null, "", location.pathname + location.search);
    }
    return localStorage.getItem(INTERNAL_KEY) === "1";
  } catch {
    return false; // storage blocked (private window, cleared site data)
  }
}

export const analyticsContext: AnalyticsContext = {
  config: customer,
  appVersion: `${__APP_VERSION__}+${__APP_COMMIT__}`,
  browser: browserFamily(navigator.userAgent),
  internal: internalBrowser(),
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
