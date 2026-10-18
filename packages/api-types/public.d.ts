/**
 * Public, read-only API (`/api/public/*`): what the website shows to visitors who
 * are not signed in. Served from content/ and the site configuration only, never
 * from the database, so nothing here is org- or user-specific. Responses are
 * cacheable (`Cache-Control: public`, `ETag`) and rate-limited per client address.
 *
 * `SiteConfig` mirrors packages/lab-schema/schema/site.schema.json (the file
 * contract, `cloudtrain.dev/v1 Site`); the gateway validates the file against the
 * schema and the generated `Site` type must stay assignable to this one.
 */

import type { Difficulty, Domain, FrameworkId } from './index.js';
import type { ExamDomain, ExamRules, RetakePolicy, ExamAvailability, ExamObjectiveInfo } from './exam.js';

/* ================================================================ site configuration */

export type SiteTheme = 'dark' | 'light' | 'cream';

export type SiteFeatureIcon = 'server' | 'shield' | 'graduation' | 'flag' | 'users' | 'network' | 'boxes' | 'terminal' | 'timer' | 'check' | 'sparkles' | 'chart' | 'lock' | 'cloud' | 'route' | 'eye';

export interface SiteLink {
  label: string;
  /** Internal path (`/pricing`) or URL (`https://`, `mailto:`, `tel:`). */
  to: string;
  /** Open in a new tab; defaults to true for http(s) URLs. */
  external?: boolean;
}

export interface SiteCta {
  label: string;
  to: string;
}

export interface SiteFeatureBlock {
  icon: SiteFeatureIcon;
  title: string;
  body: string;
}

export interface SiteLegalSection {
  title: string;
  paragraphs: string[];
}

export interface SiteLegalDocument {
  title: string;
  /** `YYYY-MM-DD`. */
  updated: string;
  /** True while the text awaits legal review; the page says so. */
  placeholder: boolean;
  sections: SiteLegalSection[];
}

/* ---------------------------------------------------------------- plans */

/** Environment tiers of the curriculum (`envTiers`): A pod, B Kata pod, C VM, K kubeadm cluster, V virtual cluster, N netdev. */
export type EnvTier = 'A' | 'B' | 'C' | 'K' | 'V' | 'N';

export type PlanKind = 'free' | 'individual' | 'organisation';
export type PlanInterval = 'monthly' | 'yearly';

/** What a plan allows. Recorded and displayed; not enforced yet. */
export interface PlanEntitlements {
  labHoursPerMonth: number | 'unlimited';
  concurrentLabs: number;
  envTiers: EnvTier[];
  examSimulationsPerMonth: number | 'unlimited';
  ctfEvents: boolean;
}

export interface PlanPrice {
  /** Minor units (cents) per interval, per seat for per-seat plans. */
  amount: number;
  /** Stripe Price lookup key, unique across plans. */
  lookupKey: string;
}

export interface SitePlan {
  id: string;
  name: string;
  kind: PlanKind;
  description: string;
  badge?: string;
  highlight?: boolean;
  /** Absent for free plans. */
  prices?: { monthly?: PlanPrice; yearly?: PlanPrice };
  perSeat?: boolean;
  minSeats?: number;
  maxSeats?: number;
  placeholderPrices?: boolean;
  entitlements: PlanEntitlements;
  includes: string[];
  cta: { label: string; action: 'signin' | 'checkout' | 'contact'; to?: string };
}

export interface SitePlans {
  /** ISO 4217. */
  currency: string;
  placeholder?: boolean;
  taxNote?: string;
  billingNote?: string;
  items: SitePlan[];
}

/** CSS custom property overrides: `--token` -> value. */
export type SiteTokenMap = Record<string, string>;

export interface SiteConfig {
  apiVersion: 'cloudtrain.dev/v1';
  kind: 'Site';
  brand: {
    name: string;
    legalName?: string;
    tagline: string;
    logo?: string;
    logoDark?: string;
    favicon?: string;
  };
  hero: {
    eyebrow?: string;
    title: string;
    subtitle: string;
    primaryCta?: SiteCta;
    secondaryCta?: SiteCta;
    note?: string;
  };
  /** Domains shown on the landing page, in order. */
  highlightDomains: Domain[];
  features: SiteFeatureBlock[];
  howItWorks: { title: string; body: string }[];
  screenshots?: { image: string; alt: string; caption?: string }[];
  faq: { q: string; a: string; group?: string }[];
  about: { title: string; paragraphs: string[]; facts?: { label: string; value: string }[] };
  contact: {
    title?: string;
    intro?: string;
    email: string;
    salesEmail?: string;
    phone?: string;
    address?: string[];
    hours?: string;
    links?: SiteLink[];
  };
  footer: {
    columns: { title: string; links: SiteLink[] }[];
    note?: string;
  };
  legal: {
    /** Shown wherever frameworks are named: not affiliated, trademarks, no certification. */
    alignmentNotice: string;
    terms: SiteLegalDocument;
    privacy: SiteLegalDocument;
  };
  theme?: {
    default?: SiteTheme;
    tokens?: { all?: SiteTokenMap; dark?: SiteTokenMap; light?: SiteTokenMap; cream?: SiteTokenMap };
  };
  flags: {
    showPricing: boolean;
    showCatalog: boolean;
    signupEnabled: boolean;
    showContactForm?: boolean;
    /** Self-service checkout for paid plans (needs the gateway's billing integration). */
    checkoutEnabled?: boolean;
  };
  pricing?: {
    headline?: string;
    intro?: string;
    placeholderNote?: string;
    contactCta?: SiteCta;
    /** FAQ group listed under the plans. */
    faqGroup?: string;
  };
  plans?: SitePlans;
}

/* ================================================================ public catalog */

export interface PublicDomain {
  id: Domain;
  name: string;
  tagline: string;
  labCount: number;
  pathCount: number;
  examCount: number;
}

/** A learning path (pack path) or a course (one module of a pack), read-only. */
export interface PublicPath {
  id: string;
  kind: 'path' | 'course';
  title: string;
  domain: Domain;
  description: string;
  framework?: FrameworkId;
  labCount: number;
  estimatedMinutes: number;
  /** Alignment disclaimer of the framework, when the path aligns to one. */
  disclaimer?: string;
}

export interface PublicLab {
  id: string;
  title: string;
  domain: Domain;
  difficulty: Difficulty;
  estimatedMinutes: number;
  frameworks?: string[];
  tags?: string[];
  skillIds: string[];
  pathId?: string;
  /** Number of questions when the lab is a CTF investigation. */
  questionCount?: number;
}

export interface PublicFramework {
  id: FrameworkId;
  name: string;
  fullName: string;
  vendor: string;
  domain?: Domain;
  group: string;
  coverage: number;
  disclaimer?: string;
}

export interface PublicExam {
  id: string;
  title: string;
  domain: ExamDomain;
  alignsTo: string[];
  /** Must be shown wherever the exam is offered. */
  disclaimer: string;
  format: 'practical' | 'practical-simulation';
  durationMinutes: number;
  passMark: number;
  passMarkNote?: string;
  taskCount: number;
  environment: 'shared' | 'per-task';
  availability: ExamAvailability;
  availabilityNote?: string;
  rules: ExamRules;
  retakePolicy: RetakePolicy;
}

export interface PublicExamDetail extends PublicExam {
  description?: string;
  simulationNote?: string;
  /** Objectives with weights and pool sizes; pool task ids are never exposed. */
  objectives: ExamObjectiveInfo[];
  reportIncludes: string[];
}

/** `GET /api/public/catalog`. */
export interface PublicCatalog {
  domains: PublicDomain[];
  paths: PublicPath[];
  labs: PublicLab[];
  exams: PublicExam[];
  frameworks: PublicFramework[];
  /** Skill id -> display name, for lab skill tags. */
  skillNames: Record<string, string>;
}

/** `GET /api/public/paths/:id`. */
export interface PublicPathDetail extends PublicPath {
  /** Courses of a pack path (in order); a course has one section holding all its labs. */
  sections: { id: string; title: string; description?: string; labIds: string[] }[];
  labs: PublicLab[];
  /** Other paths or courses in the same domain. */
  related: PublicPath[];
}
