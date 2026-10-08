export * from "./model.js";
export type { CustomerConfig, ReferenceRule, Tolerances } from "./customer.js";
export { ExtractionError } from "./errors.js";
export { reconcile, matcherFor } from "./reconcile/reconcile.js";
export { NameMatcher, type ParsedName, type NameComparison } from "./reconcile/names/NameMatcher.js";
export { DEFAULT_DICTIONARY, extendDictionary, type NameDictionary } from "./reconcile/names/dictionary.js";
export { OWN_DOCUMENT_PARSERS, SUPPLIER_PARSERS } from "./parsers/registry.js";
