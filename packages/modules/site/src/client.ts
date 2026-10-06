/**
 * Der clientseitig verwendbare Teil des Moduls: die reine Abbildung zwischen
 * gespeichertem JSON-Schema und Zod plus die Resync-Befundtypen. Kein Node,
 * keine Datenbank — damit die Maske dieselbe Abbildung nutzt wie der Dienst.
 */
export { blankValue, fieldGroups, fieldSizeOf, schemaFor, widgetOf, type FieldSize } from './field-schema';
export { flatten, kindOf, losesContent } from './resync/plan';
export type { Finding } from './resync/plan';
export type { CollectionSchema, FieldSchema, SeedReport, TemplateSchema } from './types';
export { classifyDeployError } from './pipeline/deploy-errors';
export type { DeployProblem } from './pipeline/deploy-errors';
export type { DeployCheckItem, DeployCheckKey } from './pipeline/deploy-check';
