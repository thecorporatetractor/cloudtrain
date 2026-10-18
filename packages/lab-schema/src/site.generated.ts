/* eslint-disable */
/**
 * GENERATED from schema/site.schema.json by scripts/gen-types.mjs. Do not edit by hand.
 */

/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "href".
 */
export type Href = string;
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "domain".
 */
export type Domain = "kubernetes" | "linux" | "containers" | "iac" | "automation" | "networking";
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "icon".
 */
export type Icon =
  | "server"
  | "shield"
  | "graduation"
  | "flag"
  | "users"
  | "network"
  | "boxes"
  | "terminal"
  | "timer"
  | "check"
  | "sparkles"
  | "chart"
  | "lock"
  | "cloud"
  | "route"
  | "eye"
  | "user"
  | "building"
  | "target"
  | "layers";
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "email".
 */
export type Email = string;

/**
 * Configuration of the public website served by the same web app as the platform (apps/web) and the gateway (`GET /api/public/site`). Brand, copy, differentiators, product showcase, audiences, feature blocks, FAQ, contact, footer, legal placeholders, highlighted domains, theme token overrides, feature flags and plans. The default lives in content/site.yaml; a deployment replaces it with its own file (CT_SITE_CONFIG, e.g. a ConfigMap mount) without a code change.
 */
export interface Site {
  apiVersion: "cloudtrain.dev/v1";
  kind: "Site";
  brand: {
    /**
     * Product name shown in the header, titles and the footer.
     */
    name: string;
    /**
     * Legal entity for the copyright line; defaults to the brand name.
     */
    legalName?: string;
    tagline: string;
    /**
     * URL or absolute path of a logo image (SVG or PNG) for the header. Absent: the built-in mark.
     */
    logo?: string;
    /**
     * Logo variant for the dark theme; defaults to `logo`.
     */
    logoDark?: string;
    /**
     * URL or absolute path of the favicon. Absent: the built-in one.
     */
    favicon?: string;
  };
  hero: {
    eyebrow?: string;
    title: string;
    subtitle: string;
    primaryCta?: Cta;
    secondaryCta?: Cta;
    /**
     * Small print under the buttons (e.g. no credit card, SSO for teams).
     */
    note?: string;
    preview?: Figure;
    /**
     * Short attributes under the buttons, after the live catalog figures (e.g. `Graded on the end state`).
     *
     * @maxItems 4
     */
    proof?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
  };
  /**
   * Domains shown on the landing page, in this order. Each must exist in the catalog.
   *
   * @minItems 1
   * @maxItems 6
   */
  highlightDomains:
    | [Domain]
    | [Domain, Domain]
    | [Domain, Domain, Domain]
    | [Domain, Domain, Domain, Domain]
    | [Domain, Domain, Domain, Domain, Domain]
    | [Domain, Domain, Domain, Domain, Domain, Domain];
  /**
   * Secondary capability blocks on the landing page (shown after the differentiators) and reused by other pages.
   *
   * @minItems 1
   * @maxItems 12
   */
  features:
    | [FeatureBlock]
    | [FeatureBlock, FeatureBlock]
    | [FeatureBlock, FeatureBlock, FeatureBlock]
    | [FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock]
    | [FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock]
    | [FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock]
    | [FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock]
    | [FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock, FeatureBlock]
    | [
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock
      ]
    | [
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock
      ]
    | [
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock
      ]
    | [
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock,
        FeatureBlock
      ];
  /**
   * Numbered steps describing how a lab works.
   *
   * @minItems 2
   * @maxItems 6
   */
  howItWorks:
    | [
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        }
      ]
    | [
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        }
      ]
    | [
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        }
      ]
    | [
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        }
      ]
    | [
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        },
        {
          title: string;
          body: string;
          icon?: Icon;
        }
      ];
  /**
   * What makes the platform different: a headline, a short explanation and an optional real screenshot each.
   *
   * @minItems 2
   * @maxItems 4
   */
  differentiators?:
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        }
      ]
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        }
      ]
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          figure?: Figure1;
        }
      ];
  /**
   * Product views on the landing page, each a real screenshot with a title, what it shows and why it matters.
   *
   * @minItems 1
   * @maxItems 6
   */
  showcase?:
    | [
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        }
      ]
    | [
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        }
      ]
    | [
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        }
      ]
    | [
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        }
      ]
    | [
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        }
      ]
    | [
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        },
        {
          title: string;
          body: string;
          /**
           * One sentence on why the view matters.
           */
          why?: string;
          figure: Figure1;
        }
      ];
  /**
   * Who the platform is for, each with its own next step.
   *
   * @minItems 1
   * @maxItems 4
   */
  audiences?:
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        }
      ]
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        }
      ]
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        }
      ]
    | [
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        },
        {
          icon?: Icon;
          title: string;
          body: string;
          /**
           * @maxItems 4
           */
          points?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
          cta: Cta;
        }
      ];
  /**
   * @minItems 1
   * @maxItems 40
   */
  faq: [
    {
      q: string;
      a: string;
      /**
       * Optional heading the question is listed under.
       */
      group?: string;
      /**
       * Also shown in the landing page's trust section (at most six).
       */
      featured?: boolean;
    },
    ...{
      q: string;
      a: string;
      /**
       * Optional heading the question is listed under.
       */
      group?: string;
      /**
       * Also shown in the landing page's trust section (at most six).
       */
      featured?: boolean;
    }[]
  ];
  about: {
    title: string;
    /**
     * @minItems 1
     * @maxItems 12
     */
    paragraphs:
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string];
    /**
     * @maxItems 8
     */
    facts?:
      | []
      | [
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ]
      | [
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          },
          {
            label: string;
            value: string;
          }
        ];
  };
  contact: {
    title?: string;
    intro?: string;
    email: Email;
    salesEmail?: Email;
    phone?: string;
    /**
     * Postal address, one line per item.
     *
     * @maxItems 6
     */
    address?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string];
    hours?: string;
    /**
     * @maxItems 8
     */
    links?:
      | []
      | [Link]
      | [Link, Link]
      | [Link, Link, Link]
      | [Link, Link, Link, Link]
      | [Link, Link, Link, Link, Link]
      | [Link, Link, Link, Link, Link, Link]
      | [Link, Link, Link, Link, Link, Link, Link]
      | [Link, Link, Link, Link, Link, Link, Link, Link];
  };
  footer: {
    /**
     * @maxItems 5
     */
    columns:
      | []
      | [
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          }
        ]
      | [
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          }
        ]
      | [
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          }
        ]
      | [
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          }
        ]
      | [
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          },
          {
            title: string;
            /**
             * @minItems 1
             * @maxItems 10
             */
            links:
              | [Link]
              | [Link, Link]
              | [Link, Link, Link]
              | [Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link]
              | [Link, Link, Link, Link, Link, Link, Link, Link, Link, Link];
          }
        ];
    /**
     * Short text under the columns (e.g. source-available notice).
     */
    note?: string;
  };
  legal: {
    /**
     * Shown wherever frameworks are named (footer, catalog, pricing): the platform is not affiliated with the certifying bodies, trademarks belong to their owners, no certification is conferred.
     */
    alignmentNotice: string;
    terms: LegalDocument;
    privacy: LegalDocument;
  };
  theme?: {
    /**
     * Theme for first-time visitors (the user's choice is remembered).
     */
    default?: "dark" | "light" | "cream";
    /**
     * Design-token overrides per theme (CSS custom properties from apps/web/src/styles/tokens.css, e.g. `--accent`). `all` applies to every theme first.
     */
    tokens?: {
      all?: TokenMap;
      dark?: TokenMap;
      light?: TokenMap;
      cream?: TokenMap;
    };
  };
  flags: {
    /**
     * Pricing page and its navigation link.
     */
    showPricing: boolean;
    /**
     * Public read-only catalog (paths, courses, labs, exam simulations).
     */
    showCatalog: boolean;
    /**
     * Self-service sign-up. Off: calls to action lead to sign-in or contact.
     */
    signupEnabled: boolean;
    /**
     * Contact form on the contact page (needs a backend); off shows the contact details only.
     */
    showContactForm?: boolean;
    /**
     * Self-service checkout for paid plans (needs the gateway's billing integration, CT_BILLING_ENABLED). Off: paid-plan calls to action lead to contact.
     */
    checkoutEnabled?: boolean;
  };
  /**
   * Pricing page copy around the plans.
   */
  pricing?: {
    headline?: string;
    intro?: string;
    /**
     * Shown while prices are placeholders.
     */
    placeholderNote?: string;
    contactCta?: Cta;
    /**
     * FAQ group shown under the plans (entries of `faq` with this `group`).
     */
    faqGroup?: string;
  };
  /**
   * Plans shown on the pricing page and used by billing (Stripe Products and Prices are created from them by lookup key). Three shapes: free, individual (monthly/yearly) and organisation (per seat).
   */
  plans?: {
    /**
     * ISO 4217 code; amounts are in the currency's minor unit (cents).
     */
    currency: string;
    /**
     * Every price is a placeholder, not an offer; the page says so.
     */
    placeholder?: boolean;
    /**
     * E.g. 'Prices exclude VAT.'
     */
    taxNote?: string;
    billingNote?: string;
    /**
     * @minItems 1
     * @maxItems 6
     */
    items:
      | [Plan]
      | [Plan, Plan]
      | [Plan, Plan, Plan]
      | [Plan, Plan, Plan, Plan]
      | [Plan, Plan, Plan, Plan, Plan]
      | [Plan, Plan, Plan, Plan, Plan, Plan];
  };
  /**
   * The closing call to action on the landing page; the buttons default to the hero's.
   */
  closing?: {
    title: string;
    body?: string;
    primaryCta?: Cta;
    secondaryCta?: Cta;
  };
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "cta".
 */
export interface Cta {
  label: string;
  to: Href;
}
/**
 * The product preview beside the headline.
 */
export interface Figure {
  /**
   * Absolute path served by the web app (apps/web/public, e.g. `/site/workspace-dark.webp`, captured by apps/web/scripts/site-shots.mjs) or a URL.
   */
  image: string;
  /**
   * Variant shown in the light and cream themes; defaults to `image`.
   */
  imageLight?: string;
  alt: string;
  width?: number;
  height?: number;
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "featureBlock".
 */
export interface FeatureBlock {
  icon:
    | "server"
    | "shield"
    | "graduation"
    | "flag"
    | "users"
    | "network"
    | "boxes"
    | "terminal"
    | "timer"
    | "check"
    | "sparkles"
    | "chart"
    | "lock"
    | "cloud"
    | "route"
    | "eye"
    | "user"
    | "building"
    | "target"
    | "layers";
  title: string;
  body: string;
}
/**
 * A product screenshot: the dark-theme image, an optional light-theme variant (used for the light and cream themes), alt text and the intrinsic size (reserves the space before the image loads).
 *
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "figure".
 */
export interface Figure1 {
  /**
   * Absolute path served by the web app (apps/web/public, e.g. `/site/workspace-dark.webp`, captured by apps/web/scripts/site-shots.mjs) or a URL.
   */
  image: string;
  /**
   * Variant shown in the light and cream themes; defaults to `image`.
   */
  imageLight?: string;
  alt: string;
  width?: number;
  height?: number;
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "link".
 */
export interface Link {
  label: string;
  /**
   * Internal path (`/pricing`) or URL.
   */
  to: string;
  /**
   * Open in a new tab (defaults to true for http(s) URLs).
   */
  external?: boolean;
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "legalDocument".
 */
export interface LegalDocument {
  title: string;
  updated: string;
  /**
   * True while the text is a draft that has not passed legal review; the page says so.
   */
  placeholder: boolean;
  /**
   * @minItems 1
   * @maxItems 40
   */
  sections: [
    {
      title: string;
      /**
       * @minItems 1
       * @maxItems 20
       */
      paragraphs:
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string, string]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ];
    },
    ...{
      title: string;
      /**
       * @minItems 1
       * @maxItems 20
       */
      paragraphs:
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string, string]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string
          ];
    }[]
  ];
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "tokenMap".
 */
export interface TokenMap {
  [k: string]: string;
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "plan".
 */
export interface Plan {
  id: string;
  name: string;
  /**
   * free: no price; individual: one person, monthly or yearly; organisation: per seat, monthly or yearly.
   */
  kind: "free" | "individual" | "organisation";
  description: string;
  /**
   * Small label on the card, e.g. 'Most popular'.
   */
  badge?: string;
  /**
   * Emphasised card (at most one plan).
   */
  highlight?: boolean;
  /**
   * Required for paid plans; absent for free.
   */
  prices?: {
    monthly?: Price;
    yearly?: Price;
  };
  /**
   * Organisation plans: the price is per seat and the buyer picks a seat count.
   */
  perSeat?: boolean;
  minSeats?: number;
  maxSeats?: number;
  /**
   * This plan's prices are placeholders (also implied by `plans.placeholder`).
   */
  placeholderPrices?: boolean;
  entitlements: Entitlements;
  /**
   * Marketing bullets under the entitlements.
   *
   * @maxItems 10
   */
  includes:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
  cta: {
    label: string;
    /**
     * signin: sign in or go to the dashboard; checkout: subscribe (falls back to contact while flags.checkoutEnabled is off); contact: the contact page or `to`.
     */
    action: "signin" | "checkout" | "contact";
    /**
     * Target for `contact` (default /contact).
     */
    to?: string;
  };
}
/**
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "price".
 */
export interface Price {
  /**
   * Minor units (cents) per interval, per seat for per-seat plans.
   */
  amount: number;
  /**
   * Stripe Price lookup key; unique across plans. `stripe:sync` creates or updates the Price behind it.
   */
  lookupKey: string;
}
/**
 * What a plan allows. Recorded and displayed; enforcement comes later.
 *
 * This interface was referenced by `Site`'s JSON-Schema
 * via the `definition` "entitlements".
 */
export interface Entitlements {
  /**
   * Lab session hours per month (per learner).
   */
  labHoursPerMonth: number | "unlimited";
  /**
   * Lab sessions a learner may run at once.
   */
  concurrentLabs: number;
  /**
   * Environment tiers the plan may start (curriculum envTiers: A pod, B Kata pod, C VM, K kubeadm cluster, V virtual cluster, N netdev).
   *
   * @minItems 1
   */
  envTiers: ["A" | "B" | "C" | "K" | "V" | "N", ...("A" | "B" | "C" | "K" | "V" | "N")[]];
  /**
   * Exam simulation attempts per month (per learner).
   */
  examSimulationsPerMonth: number | "unlimited";
  /**
   * May join (and, for organisations, run) CTF events.
   */
  ctfEvents: boolean;
}
