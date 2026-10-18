/* eslint-disable */
/**
 * GENERATED from schema/curriculum.schema.json by scripts/gen-types.mjs. Do not edit by hand.
 */

/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string;
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "domain".
 */
export type Domain = "kubernetes" | "linux" | "containers" | "iac" | "automation" | "networking";
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "imageRef".
 */
export type ImageRef = string;
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "frameworkRef".
 */
export type FrameworkRef = string;
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "tier".
 */
export type Tier = "A" | "B" | "C" | "K" | "V" | "N";
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "disclaimer".
 */
export type Disclaimer = string;

/**
 * The whole curriculum as data: domains, every lab (built or proposed), learning paths and exam simulations. Single source of truth for content/curriculum.yaml; docs/curriculum.md is rendered from it.
 */
export interface Curriculum {
  apiVersion: "cloudtrain.dev/v1";
  kind: "Curriculum";
  metadata: {
    version: number;
    status: "proposal" | "approved";
    updated: string;
    summary?: string;
    conventions?: string[];
  };
  /**
   * Environment tiers a lab can run on.
   */
  envTiers: {
    [k: string]: {
      title: string;
      substrate: string;
      authenticFor?: string;
    };
  };
  /**
   * Alignment targets authored here (not by hand in content/frameworks). tools/curriculum/render.mjs generates content/frameworks/<id>.yaml from each, mapping objectives to the skills of the labs that reference them. Objective refs '<id>:<objective>' resolve against these or content/frameworks/*.yaml.
   */
  frameworks: {
    id: Id;
    title: string;
    /**
     * Short learner-facing name for pickers and badges (e.g. RHCSA). Never an exam code. Defaults to an acronym in parentheses in the title, else the id.
     */
    shortName?: string;
    /**
     * Domain the framework is grouped under in the UI; cross-domain frameworks group as Platform. Defaults to the domain of most labs that reference it.
     */
    domain?: Domain | "cross-domain";
    /**
     * Certifying body, or 'CloudTrain' for internal frameworks.
     */
    body?: string;
    version?: string;
    weightsSource?: "published" | "cloudtrain" | "none";
    notes?: string;
    /**
     * @minItems 1
     */
    objectives: [
      {
        id: Id;
        title: string;
        weight?: number;
      },
      ...{
        id: Id;
        title: string;
        weight?: number;
      }[]
    ];
  }[];
  /**
   * Proposed image catalog refs (not yet in deploy/images/catalog.yaml).
   */
  images: {
    ref: ImageRef;
    kind: "container" | "containerDisk" | "service";
    tier: string;
    description: string;
    status?: "proposed" | "spike" | "available";
  }[];
  /**
   * @minItems 1
   */
  domains: [
    {
      id: Domain;
      title: string;
      summary: string;
      /**
       * Skill-graph domain id (prefix of skill ids).
       */
      skillDomain: string;
      owner: string;
      organisation?: {
        name: string;
        summary?: string;
      };
      notes?: string;
      /**
       * Licensing constraints on the tools this domain teaches (for example a source-available CLI), and what must be confirmed before offering the domain to external customers.
       */
      licensingNote?: string;
      /**
       * @minItems 1
       */
      competencies: [
        {
          id: string;
          title: string;
          new?: boolean;
        },
        ...{
          id: string;
          title: string;
          new?: boolean;
        }[]
      ];
    },
    ...{
      id: Domain;
      title: string;
      summary: string;
      /**
       * Skill-graph domain id (prefix of skill ids).
       */
      skillDomain: string;
      owner: string;
      organisation?: {
        name: string;
        summary?: string;
      };
      notes?: string;
      /**
       * Licensing constraints on the tools this domain teaches (for example a source-available CLI), and what must be confirmed before offering the domain to external customers.
       */
      licensingNote?: string;
      /**
       * @minItems 1
       */
      competencies: [
        {
          id: string;
          title: string;
          new?: boolean;
        },
        ...{
          id: string;
          title: string;
          new?: boolean;
        }[]
      ];
    }[]
  ];
  /**
   * Skills the curriculum needs that content/skills.yaml lacks. Merged into the skill graph after approval.
   */
  newSkills: {
    id: string;
    name: string;
    domain: string;
    competency: string;
    requires?: string[];
  }[];
  /**
   * @minItems 1
   */
  labs: [Lab, ...Lab[]];
  paths: Path[];
  exams: Exam[];
}
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "lab".
 */
export interface Lab {
  id: Id;
  domain: Domain;
  title: string;
  /**
   * The gradeable scenario in one sentence, set in the domain's fictional organisation.
   */
  oneLine: string;
  /**
   * exam = exam task: fully graded, no hints, only drawn by exam simulations. ctf = investigation challenge: the learner answers questions (answer checks) about a seeded dataset or system; playable solo or in a CTF event.
   */
  type: "learn" | "do" | "fix" | "hack" | "ctf" | "exam";
  difficulty: "easy" | "medium" | "hard";
  minutes: number;
  /**
   * @minItems 1
   * @maxItems 6
   */
  skills:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string];
  frameworks: FrameworkRef[];
  envTier: Tier;
  /**
   * @minItems 1
   */
  images: [ImageRef, ...ImageRef[]];
  status: "proposed" | "built" | "verified";
  owner: string;
  dependsOn?: Id[];
  notes?: string;
}
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "path".
 */
export interface Path {
  id: Id;
  domain: Domain;
  title: string;
  audience: string;
  level: "beginner" | "intermediate" | "advanced";
  prerequisites: Id[];
  estimatedHours: number;
  frameworks: string[];
  disclaimer?: Disclaimer;
  status?: "proposed" | "deferred";
  notes?: string;
  /**
   * @minItems 1
   */
  modules: [
    {
      id: Id;
      title: string;
      /**
       * @minItems 1
       */
      labs: [Id, ...Id[]];
    },
    ...{
      id: Id;
      title: string;
      /**
       * @minItems 1
       */
      labs: [Id, ...Id[]];
    }[]
  ];
}
/**
 * This interface was referenced by `Curriculum`'s JSON-Schema
 * via the `definition` "exam".
 */
export interface Exam {
  id: Id;
  title: string;
  domain: Domain | "cross-domain";
  /**
   * @minItems 1
   */
  alignsTo: [string, ...string[]];
  disclaimer: Disclaimer;
  /**
   * practical-simulation: the real exam is not (fully) hands-on; CloudTrain simulates its objectives as practical tasks.
   */
  format: "practical" | "practical-simulation";
  simulationNote?: string;
  description?: string;
  durationMinutes: number;
  passMark: number;
  passMarkNote?: string;
  taskCount: number;
  envTier: Tier;
  environment: "shared" | "per-task";
  /**
   * @minItems 1
   */
  blueprint: [
    {
      objective: FrameworkRef;
      weight: number;
      tasks: number;
      pool: Id[];
    },
    ...{
      objective: FrameworkRef;
      weight: number;
      tasks: number;
      pool: Id[];
    }[]
  ];
  rules: {
    hints: false;
    timer: "single" | "per-task";
    anyOrder?: boolean;
    flagForReview?: boolean;
    rebootBeforeGrade: boolean;
    /**
     * Re-run each task's spec.exam.rerun actions after the first grading pass and grade again (e.g. saved playbooks must report no changes). Default false.
     */
    idempotencyRerun?: boolean;
    docsAllowed?: string;
    partialCredit?: "per-check" | "per-task" | "none";
    notes?: string;
  };
  retakePolicy: {
    freeRetakes?: number;
    cooldownHours?: number;
    maxAttemptsPer30Days?: number;
    freshDraw: boolean;
    notes?: string;
  };
  scoreReport: {
    /**
     * @minItems 1
     */
    breakdown: ["objective" | "task" | "skill" | "domain", ...("objective" | "task" | "skill" | "domain")[]];
    showsExpectedValues?: boolean;
    includes?: string[];
  };
  status: "proposed" | "built" | "verified";
  owner: string;
  notes?: string;
}
