/// <reference types="vite/client" />

/** Root package.json version, injected at build time. */
declare const __APP_VERSION__: string;
/** Short git commit of the build ("-dirty" when built with uncommitted changes). */
declare const __APP_COMMIT__: string;
