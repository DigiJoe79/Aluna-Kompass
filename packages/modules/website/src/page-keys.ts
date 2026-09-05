export const WEBSITE_PAGE_KEYS = ['home', 'help', 'donate', 'sponsor', 'membership', 'about', 'partners', 'contact', 'imprint', 'privacy', 'statutes', 'adoption-process'] as const;
export type WebsitePageKey = (typeof WEBSITE_PAGE_KEYS)[number];

export const WEBSITE_DOWNLOAD_KEYS = ['sponsorship-form', 'membership-form', 'self-disclosure-form', 'statutes-pdf'] as const;
export type WebsiteDownloadKey = (typeof WEBSITE_DOWNLOAD_KEYS)[number];

export const WEBSITE_PERMISSIONS = ['website.view', 'website.manage', 'website.publish'] as const;
