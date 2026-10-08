/// <reference types="vite/client" />

/** Root package.json version, injected at build time. */
declare const __APP_VERSION__: string;
/** Short git commit of the build ("-dirty" when built with uncommitted changes). */
declare const __APP_COMMIT__: string;

/** `customers/<slug>/config.json` of the customer this build is for. */
declare module "@customer-config" {
  const config: import("@core/customer.js").CustomerConfig;
  export default config;
}
