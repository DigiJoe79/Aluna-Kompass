/**
 * Der CSP der Anwendung. Steht hier statt in `next.config.ts`, weil die
 * Vorschau-Routen der Webseite ihn für HTML selbst setzen (`lib/site-preview.ts`):
 * Ihre Pfade sind vom globalen Eintrag ausgenommen, damit Bilder und Dateien
 * darunter `sandbox` bekommen können. Begründung der einzelnen Teile in
 * `next.config.ts`.
 */
export const APP_CONTENT_SECURITY_POLICY = ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"].join('; ');
