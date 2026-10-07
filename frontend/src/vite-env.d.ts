/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "server" (default) or "client" — where PDFs are parsed. */
  readonly VITE_PARSE_MODE?: "server" | "client";
}
