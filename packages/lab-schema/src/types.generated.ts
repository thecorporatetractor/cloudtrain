/* eslint-disable */
/**
 * GENERATED from schema/lab.schema.json by scripts/gen-types.mjs. Do not edit by hand.
 */

/**
 * Runs on a node. Exactly one of run/apply/file/config.
 *
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "action".
 */
export type Action = {
  /**
   * node name, or node/cluster-node for kubeadm cluster nodes, e.g. 'web-cluster/web-cp-1'
   */
  on: string;
  /**
   * admin = out-of-band platform credentials; learner = as the learner would
   */
  as?: "learner" | "admin";
  /**
   * shell script
   */
  run?: string;
  /**
   * Kubernetes manifest (YAML) applied to the node's cluster
   */
  apply?: string;
  file?: {
    [k: string]: unknown;
  } & {
    path: string;
    content?: string;
    mode?: string;
    /**
     * Asset path relative to the lab directory (beside lab.yaml), written to `path`. The compiler inlines the asset as `content`, so it is templated like the rest of the lab: every {{param}} placeholder is replaced with the session's value, and an undefined placeholder fails validation. Literal double braces: `{{ name }}` with inner whitespace and an undeclared name stays as written (Jinja/Ansible style); other literal braces (Helm or Go templates, unspaced Jinja) are written with other delimiters and converted at setup time (e.g. `<% %>` then sed). Use instead of `content` for scripts and fixtures too large to inline. Must stay inside the lab directory: no leading '/', no '.' or '..' segments.
     */
    source?: string;
  };
  /**
   * network device configuration block
   */
  config?: string;
  timeoutSec?: number;
} & Action1;
export type Action1 = {
  [k: string]: unknown;
};
/**
 * Answer check (type answer): the check's description is the question. The expected value comes from the session: `value`/`values` reference secret {{params}}, or `compute` runs a command on a lab node right after setup (stored server side, never sent to the browser). Answers are normalised (case, whitespace) before matching.
 *
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "answer".
 */
export type Answer = {
  /**
   * exact: normalised strings are equal. number: both parse as decimal numbers within `tolerance`. regex: the normalised answer fully matches the pattern (RE2 subset shared by Go and JavaScript; template values are inserted verbatim). any-of: equal to one of the accepted values (`values`, or each non-empty line of the computed output).
   */
  match: "exact" | "number" | "regex" | "any-of";
  /**
   * Expected value (exact, number) or pattern (regex), templated with {{params}}.
   */
  value?: string;
  /**
   * Accepted values for any-of, templated with {{params}}.
   *
   * @minItems 1
   */
  values?: [string, ...string[]];
  /**
   * Computes the expected value once per session, right after setup: runs `command` as admin on `on` (default: the entry node) and keeps its stdout (trailing newline removed). For any-of, each non-empty line is one accepted value. A failing command fails the session's setup.
   */
  compute?: {
    on?: string;
    command: string;
    timeoutSec?: number;
  };
  caseSensitive?: boolean;
  /**
   * trim: strip leading/trailing whitespace. collapse: trim, then every run of whitespace becomes one space. remove: drop all whitespace. none: compare as typed.
   */
  whitespace?: "trim" | "collapse" | "remove" | "none";
  /**
   * number: the largest accepted absolute difference.
   */
  tolerance?: number;
  points?: number;
  /**
   * Wrong answers allowed before the question closes. Unlimited when absent.
   */
  maxAttempts?: number;
  /**
   * Points taken off the question's award for every wrong answer (never below 0).
   */
  penalty?: number;
  /**
   * Example of the expected format, shown in the empty answer box (e.g. 203.0.113.7).
   */
  placeholder?: string;
  /**
   * Question hints, revealed one at a time on request; each costs `cost` points off the question's award.
   */
  hints?: {
    body: string;
    cost?: number;
  }[];
} & Answer1;
export type Answer1 = {
  [k: string]: unknown;
};
/**
 * An answer the verifier submits: a string (templated with {{params}}), or a command whose stdout (trimmed) is the answer.
 *
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "answerInput".
 */
export type AnswerInput =
  | string
  | {
      /**
       * Node (default: the entry node).
       */
      on?: string;
      as?: "learner" | "admin";
      command: string;
      timeoutSec?: number;
    };

/**
 * A hands-on lab: a topology of nodes and links, setup actions, typed checks tagged with skills, and a reference solution. Domain-agnostic (Kubernetes, Linux, networking).
 */
export interface Lab {
  apiVersion: "cloudtrain.dev/v3";
  kind: "Lab";
  metadata: {
    id: string;
    title: string;
    domain: "kubernetes" | "linux" | "containers" | "iac" | "automation" | "networking";
    /**
     * Framework objective references, e.g. 'cka:cluster-architecture'.
     */
    frameworks?: string[];
    difficulty: "easy" | "medium" | "hard";
    estimatedMinutes: number;
    tags?: string[];
    version?: number;
  };
  spec: {
    /**
     * Task statement shown to the learner (Markdown). May reference {{params}}.
     */
    description: string;
    objectives?: string[];
    /**
     * Values randomised per learner attempt. Referenced as {{name}} anywhere in description, setup, checks and solution. `{{ name }}` written with inner whitespace references a param only when `name` is declared here; otherwise it stays literal text (Jinja in Ansible playbooks and templates), so avoid param names that clash with Jinja variables the lab uses.
     */
    params?: {
      [k: string]: {
        type: "choice" | "int" | "name";
        values?: unknown[];
        min?: number;
        max?: number;
        prefix?: string;
        default?: unknown;
        /**
         * Never sent to the learner's browser. Required for every param an answer check's expected value references; a secret param must not appear in learner-visible text (description, objectives, hints, check descriptions, question hints).
         */
        secret?: boolean;
      };
    };
    topology: Topology;
    setup?: Action[];
    teardown?: Action[];
    /**
     * @minItems 1
     */
    checks: [Check, ...Check[]];
    /**
     * How the lab's answer checks (questions) unlock. free: every question is open from the start. sequential: a question opens once the one before it is solved or has no attempts left.
     */
    questionOrder?: "free" | "sequential";
    hints?: {
      title: string;
      body: string;
      command?: string;
      cost?: number;
    }[];
    /**
     * Plausible wrong approaches. Each one with a `mutation` is also a mutation test: the verifier applies `mutation` instead of the solution and requires every check listed in `expectFail` to fail. A misconception without a mutation is advisory only.
     */
    misconceptions?: {
      id: string;
      description: string;
      mutation?: Action;
      /**
       * Wrong answers for answer checks (by check id): the verifier submits each one in a fresh session and requires every check listed in `expectFail` to reject it. Use instead of `mutation`.
       */
      answers?: {
        [k: string]: AnswerInput;
      };
      /**
       * Ids of the checks aimed at this misconception. Each must fail after `mutation` (end-state checks) or reject the answer given in `answers` (answer checks); failures of other checks (e.g. the context check) do not count.
       *
       * @minItems 1
       */
      expectFail?: [string, ...string[]];
      feedback?: string;
    }[];
    /**
     * Exam-task extras (labs drawn by exam simulations). `rerun` actions run after the first grading pass when the exam's rules set idempotencyRerun (e.g. re-run the candidate's saved playbook and assert it reports no changes); a failing action fails the task's checks, then every check is graded again.
     */
    exam?: {
      rerun?: Action[];
    };
    /**
     * The reference solution: `steps` for end-state checks, `answers` for answer checks (a lab with both has both).
     */
    solution: {
      [k: string]: unknown;
    } & {
      explanation?: string;
      /**
       * @minItems 1
       */
      steps?: [Action, ...Action[]];
      /**
       * The correct answer for every answer check (by check id). The verifier runs the steps first, then submits each answer and requires it to be accepted. Prefer a command (derive the answer from the lab like a learner would) over a templated string.
       */
      answers?: {
        [k: string]: AnswerInput;
      };
      /**
       * Other valid ways to solve the lab. The Scenario Studio verifier applies each alternative's steps in a fresh session and requires every check to pass, so a correct but different approach is never penalised.
       */
      alternatives?: {
        id: string;
        description: string;
        /**
         * @minItems 1
         */
        steps: [Action, ...Action[]];
      }[];
    };
  };
}
/**
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "topology".
 */
export interface Topology {
  /**
   * Node the learner's terminal opens on (usually the jumphost).
   */
  entry?: string;
  /**
   * @minItems 1
   */
  nodes: [Node, ...Node[]];
  links?: Link[];
}
/**
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "node".
 */
export interface Node {
  name: string;
  driver: "container" | "vm" | "k8s-cluster" | "netdev";
  /**
   * Catalog image ref, e.g. 'jumphost:1', 'ubuntu:24.04', 'frr:10', 'kubeadm:1.35'.
   */
  image?: string;
  resources?: {
    cpu?: number;
    memoryMiB?: number;
    /**
     * vm nodes: sizes of extra blank data disks (e.g. ["2Gi", "2Gi"]), attached as /dev/vdb, /dev/vdc, ... with serials ct-data1, ct-data2, ... (/dev/disk/by-id/virtio-ct-dataN)
     *
     * @maxItems 6
     */
    disks?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string];
  };
  access?: ("shell" | "ssh" | "console" | "web" | "rdp")[];
  /**
   * Entry container node only. SECURITY TRADE-OFF, opt-in: lets setuid/setgid programs (sudo, crontab, passwd, su) raise the learner's privileges (allowPrivilegeEscalation true instead of false on the node container). The learner can then become root in the container (unprivileged, default capabilities; inside a user namespace when the image is marked userNamespace and the cluster supports it). The platform only lifts no_new_privs: the image or the lab's setup must grant the sudo rule (e.g. /etc/sudoers.d/learner). Operators can refuse such labs with the manager flag --allow-learner-sudo=false.
   */
  learnerSudo?: boolean;
  /**
   * Only for driver=k8s-cluster.
   */
  cluster?: {
    /**
     * virtual = vcluster (API-only), kubeadm = real VM nodes
     */
    mode?: "virtual" | "kubeadm";
    version?: string;
    /**
     * kubeconfig context name exposed on the entry node
     */
    context?: string;
    nodes?: {
      name: string;
      role: "control-plane" | "worker";
      taints?: string[];
      labels?: {
        [k: string]: string;
      };
      state?: "ready" | "notready";
    }[];
  };
}
/**
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "link".
 */
export interface Link {
  /**
   * node:interface
   */
  a: string;
  b: string;
  subnet?: string;
  impair?: {
    latencyMs?: number;
    lossPct?: number;
    mtu?: number;
  };
}
/**
 * This interface was referenced by `Lab`'s JSON-Schema
 * via the `definition` "check".
 */
export interface Check {
  id: string;
  description: string;
  /**
   * Skill ids from content/skills.yaml
   *
   * @minItems 1
   */
  skills: [string, ...string[]];
  weight?: number;
  /**
   * answer: a question the learner answers in the lab view (CTF style); the platform grades the submitted answer against `answer`. Every other type grades the lab's end state when the learner validates.
   */
  type:
    | "shell"
    | "k8s-query"
    | "k8s-can-i"
    | "k8s-context"
    | "file"
    | "service-state"
    | "reachability"
    | "device-cmd"
    | "http"
    | "answer";
  answer?: Answer;
  on?: string;
  command?: string;
  query?: {
    cluster?: string;
    resource?: string;
    name?: string;
    namespace?: string;
    jsonpath?: string;
    verb?: string;
    as?: string;
  };
  target?: string;
  port?: number;
  expect?: {
    match: "exact" | "not_exact" | "contains" | "not_contains" | "regex";
    value: string;
  };
  /**
   * Seconds before the check counts as timed out (max 300). Default 30 for shell checks (they often make several calls), 20 for k8s-query, k8s-can-i and k8s-context (one kubectl call, slow under load), 5 for every other type.
   */
  timeoutSec?: number;
}
