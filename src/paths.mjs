import { fileURLToPath } from 'node:url';

// Resolve against this template, never the caller's current directory.
export const rootUrl = new URL('../', import.meta.url);
export const root = fileURLToPath(rootUrl);
