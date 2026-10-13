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
 * A hands-on lab: a topology of nodes and links, setup actions, typed checks tagged with skills, and a reference solution. Domain-agnostic (Kubernetes, Linux, networking).
 */
export interface Lab {
  apiVersion: "cloudtrain.dev/v3";
  kind: "Lab";
  metadata: {
    id: string;
    title: string;
    domain: "kubernetes" | "linux" | "networking";
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
     * Values randomised per learner attempt. Referenced as {{name}} anywhere in description, setup, checks and solution.
     */
    params?: {
      [k: string]: {
        type: "choice" | "int" | "name";
        values?: unknown[];
        min?: number;
        max?: number;
        prefix?: string;
        default?: unknown;
      };
    };
    topology: Topology;
    setup?: Action[];
    teardown?: Action[];
    /**
     * @minItems 1
     */
    checks: [Check, ...Check[]];
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
       * Ids of the checks aimed at this misconception. Each must fail after `mutation`; failures of other checks (e.g. the context check) do not count.
       *
       * @minItems 1
       */
      expectFail?: [string, ...string[]];
      feedback?: string;
    }[];
    solution: {
      explanation?: string;
      /**
       * @minItems 1
       */
      steps: [Action, ...Action[]];
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
    disks?: string[];
  };
  access?: ("shell" | "ssh" | "console" | "web" | "rdp")[];
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
  type:
    | "shell"
    | "k8s-query"
    | "k8s-can-i"
    | "k8s-context"
    | "file"
    | "service-state"
    | "reachability"
    | "device-cmd"
    | "http";
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
  timeoutSec?: number;
}
