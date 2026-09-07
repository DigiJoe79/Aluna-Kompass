import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { animalCreateSchema, animalPhotosSchema, animalStatusSchema, animalStorySchema, animalUpdateSchema, createAnimal, getAnimal, listAnimals, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from './service';

const t = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler']): McpToolDefinition => ({ name, description, inputSchema, handler });

export const ANIMALS_MCP_TOOLS: McpToolDefinition[] = [
  t('animals_list', 'List all animals. Requires animals.view.', z.object({}), (deps, ctx) => listAnimals(deps, ctx)),
  t('animals_get', 'Read one animal profile with photos and story. Requires animals.view.', z.object({ id: z.string() }), (deps, ctx, args) => getAnimal(deps, ctx, (args as { id: string }).id)),
  t('animals_create', 'Create an animal profile (unpublished). Requires animals.manage.', animalCreateSchema, (deps, ctx, args) => createAnimal(deps, ctx, args)),
  t('animals_update', 'Update an animal profile. Requires animals.manage.', animalUpdateSchema, (deps, ctx, args) => updateAnimal(deps, ctx, args)),
  t('animals_set_status', 'Change adoption status of an animal. Requires animals.manage.', animalStatusSchema, (deps, ctx, args) => setAnimalStatus(deps, ctx, args)),
  t('animals_set_photos', 'Replace photo gallery of an animal. Requires animals.manage.', animalPhotosSchema, (deps, ctx, args) => setAnimalPhotos(deps, ctx, args)),
  t('animals_set_story', 'Set adoption success story of an adopted animal. Requires animals.manage.', animalStorySchema, (deps, ctx, args) => setAnimalStory(deps, ctx, args)),
  t('animals_set_published', 'Publish or unpublish an animal profile. Requires animals.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setAnimalPublished(deps, ctx, args)),
];
