import { createProject, getProject, listProjects, projectCreateSchema, projectUpdateSchema, setProjectPublished, updateProject, type McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { articleCreateSchema, articleUpdateSchema, createArticle, listArticles, setArticlePublished, updateArticle } from './services/articles';
import { downloadSetSchema, listDownloads, setDownload } from './services/downloads';
import { createFaq, faqCreateSchema, faqUpdateSchema, listFaqs, setFaqPublished, updateFaq } from './services/faqs';
import { getPage, listPages, pageUpdateSchema, updatePage } from './services/pages';
import { createTeamMember, listTeam, setTeamMemberPublished, teamCreateSchema, teamUpdateSchema, updateTeamMember } from './services/team';

const t = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler']): McpToolDefinition => ({ name, description, inputSchema, handler });

export const WEBSITE_MCP_TOOLS: McpToolDefinition[] = [
  t('website_pages_list', 'List all website pages with their bilingual texts and blocks. Requires website.view.', z.object({}), (deps, ctx) => listPages(deps, ctx)),
  t('website_page_get', 'Read one website page by key (e.g. home, help, about). Requires website.view.', z.object({ key: z.string() }), (deps, ctx, args) => getPage(deps, ctx, (args as { key: string }).key)),
  t('website_page_update', 'Update texts (de/en) and blocks of a page. Requires website.manage. Audited.', pageUpdateSchema, (deps, ctx, args) => updatePage(deps, ctx, args)),
  t('website_articles_list', 'List articles (Wissenswertes). Requires website.view.', z.object({}), (deps, ctx) => listArticles(deps, ctx)),
  t('website_article_create', 'Create an article (unpublished). Requires website.manage.', articleCreateSchema, (deps, ctx, args) => createArticle(deps, ctx, args)),
  t('website_article_update', 'Update an article. Requires website.manage.', articleUpdateSchema, (deps, ctx, args) => updateArticle(deps, ctx, args)),
  t('website_article_set_published', 'Publish or unpublish an article. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setArticlePublished(deps, ctx, args)),
  t('website_team_list', 'List team members. Requires website.view.', z.object({}), (deps, ctx) => listTeam(deps, ctx)),
  t('website_team_create', 'Create a team member. Requires website.manage.', teamCreateSchema, (deps, ctx, args) => createTeamMember(deps, ctx, args)),
  t('website_team_update', 'Update a team member. Requires website.manage.', teamUpdateSchema, (deps, ctx, args) => updateTeamMember(deps, ctx, args)),
  t('website_team_set_published', 'Publish or unpublish a team member. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setTeamMemberPublished(deps, ctx, args)),
  t('website_faqs_list', 'List FAQ entries. Requires website.view.', z.object({}), (deps, ctx) => listFaqs(deps, ctx)),
  t('website_faq_create', 'Create an FAQ entry. Requires website.manage.', faqCreateSchema, (deps, ctx, args) => createFaq(deps, ctx, args)),
  t('website_faq_update', 'Update an FAQ entry. Requires website.manage.', faqUpdateSchema, (deps, ctx, args) => updateFaq(deps, ctx, args)),
  t('website_faq_set_published', 'Publish or unpublish an FAQ entry. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setFaqPublished(deps, ctx, args)),
  t('website_downloads_list', 'List download slots (PDF forms). Requires website.view.', z.object({}), (deps, ctx) => listDownloads(deps, ctx)),
  t('website_download_set', 'Attach a PDF media asset to a download slot. Requires website.manage.', downloadSetSchema, (deps, ctx, args) => setDownload(deps, ctx, args)),
  t('website_projects_list', 'List projects with public fields. Requires website.view.', z.object({}), (deps, ctx) => listProjects(deps, ctx)),
  t('website_project_get', 'Read one project. Requires website.view.', z.object({ id: z.string() }), (deps, ctx, args) => getProject(deps, ctx, (args as { id: string }).id)),
  t('website_project_create', 'Create a project (unpublished). Requires website.manage.', projectCreateSchema, (deps, ctx, args) => createProject(deps, ctx, args)),
  t('website_project_update', 'Update a project. Requires website.manage.', projectUpdateSchema, (deps, ctx, args) => updateProject(deps, ctx, args)),
  t('website_project_set_published', 'Publish or unpublish a project. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setProjectPublished(deps, ctx, args)),
];
