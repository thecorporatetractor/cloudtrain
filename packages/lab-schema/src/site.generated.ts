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
   * Launch state of the public website. `coming-soon` renders one standalone landing (what the platform is, how pricing works, the waitlist, questions and the legal links) on every website path except the legal pages, and hides sign-in, checkout and every link into the platform. `live` renders the full website. A static build can override the mode (build-site --launch).
   */
  launch?: {
    /**
     * coming-soon: the standalone pre-launch landing; live: the full website.
     */
    mode: "coming-soon" | "live";
    eyebrow?: string;
    /**
     * Coming-soon headline; defaults to hero.title.
     */
    title?: string;
    /**
     * Coming-soon lead; defaults to hero.subtitle.
     */
    subtitle?: string;
    /**
     * A short status line, e.g. 'Private beta, opening 2027'.
     */
    status?: string;
    /**
     * Label of the button that scrolls to the waitlist.
     */
    ctaLabel?: string;
    /**
     * What the platform is, in a few blocks.
     *
     * @minItems 2
     * @maxItems 6
     */
    points?:
      | [
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          }
        ]
      | [
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          }
        ]
      | [
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          }
        ]
      | [
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          }
        ]
      | [
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          },
          {
            icon?: Icon;
            title: string;
            body: string;
          }
        ];
    /**
     * FAQ groups shown on the coming-soon page; absent: the featured questions and the pricing group.
     *
     * @maxItems 6
     */
    faqGroups?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string];
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
    /**
     * How pricing works: the model in steps, copy for the compute tiers (rates come from plans.compute), worked examples and the estimator. Shown on the pricing page, the coming-soon page and, briefly, the landing page.
     */
    model?: {
      eyebrow?: string;
      title: string;
      intro?: string;
      /**
       * @minItems 2
       * @maxItems 6
       */
      steps:
        | [
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            }
          ]
        | [
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            }
          ]
        | [
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            }
          ]
        | [
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            }
          ]
        | [
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            },
            {
              icon?: Icon;
              title: string;
              body: string;
            }
          ];
      /**
       * Copy for the compute tiers; the rates are plans.compute.tiers.
       */
      tiers?: {
        pod?: {
          name: string;
          body: string;
          /**
           * @maxItems 4
           */
          examples?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
        };
        vm?: {
          name: string;
          body: string;
          /**
           * @maxItems 4
           */
          examples?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
        };
        heavy?: {
          name: string;
          body: string;
          /**
           * @maxItems 4
           */
          examples?: [] | [string] | [string, string] | [string, string, string] | [string, string, string, string];
        };
      };
      /**
       * Worked examples: a lab of a tier run for so many minutes; the cost is computed from plans.compute.
       *
       * @maxItems 6
       */
      examples?:
        | []
        | [
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            }
          ]
        | [
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            }
          ]
        | [
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            }
          ]
        | [
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            }
          ]
        | [
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            }
          ]
        | [
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            },
            {
              title: string;
              body?: string;
              tier: "pod" | "vm" | "heavy";
              minutes: number;
              /**
               * Sessions a month, for a monthly figure.
               */
              sessions?: number;
            }
          ];
      estimator?: {
        title?: string;
        note?: string;
        defaultTier?: "pod" | "vm" | "heavy";
        defaultMinutes?: number;
        defaultSessions?: number;
      };
      /**
       * Shown where a rate would be while plans.compute is not configured.
       */
      pendingNote?: string;
      /**
       * The ways to run CloudTrain, side by side (e.g. self-host free, hosted pay-for-compute, enterprise features by subscription or license key). Copy only; amounts come from plans.
       *
       * @minItems 1
       * @maxItems 4
       */
      paths?:
        | [
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            }
          ]
        | [
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            },
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            }
          ]
        | [
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            },
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            },
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            }
          ]
        | [
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            },
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            },
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            },
            {
              /**
               * `hosted` shows the compute rates under it.
               */
              id: string;
              icon?: Icon;
              eyebrow?: string;
              title: string;
              /**
               * Short price line, e.g. 'Free' or 'Per minute of compute'.
               */
              price?: string;
              body: string;
              /**
               * @maxItems 6
               */
              points?:
                | []
                | [string]
                | [string, string]
                | [string, string, string]
                | [string, string, string, string]
                | [string, string, string, string, string]
                | [string, string, string, string, string, string];
              cta?: Cta;
            }
          ];
    };
  };
  /**
   * Plans shown on the pricing page and used by billing (Stripe Products and Prices are created from them by lookup key). Three shapes: free, individual (monthly/yearly) and organisation (per seat). Learners pay for the compute their lab sessions use on top of any plan (`compute`); plans unlock premium features (`items[].features`) and early-access labs (`earlyAccess`); the free plan gives a trial lab (`free`).
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
     * The free trial: labs a free account (no payment method, no subscription) may start, uncharged, up to the caps. Everything else needs a payment method on file or a subscription.
     */
    free?: {
      /**
       * Lab ids. Short, pod-tier labs that verify reliably.
       */
      trialLabs: string[];
      /**
       * Trial sessions per learner (lifetime).
       */
      maxSessions?: number;
      /**
       * Trial compute minutes per learner (lifetime).
       */
      maxMinutes?: number;
    };
    /**
     * Pay for compute: every lab session is metered (wall-clock minutes x the tier's units per minute) and reported to a Stripe Billing Meter; a metered Price bills the units.
     */
    compute?: {
      /**
       * Price of one compute unit in minor units of `currency`, as a decimal string (Stripe unit_amount_decimal), e.g. '0.5' = half a cent.
       */
      unitPrice: string;
      /**
       * Lookup key of the metered Price stripe:sync creates.
       */
      lookupKey: string;
      /**
       * Event name of the Stripe Billing Meter (sum of `value`).
       */
      meterEventName: string;
      /**
       * Billed minutes are rounded up; a session is billed at least this many.
       */
      minimumMinutes?: number;
      /**
       * The rates are placeholders, not offers.
       */
      placeholder?: boolean;
      /**
       * Compute tiers, derived from a lab's topology: pod (container nodes and virtual clusters), vm (one VM), heavy (two or more VMs, a kubeadm cluster or a netdev topology).
       */
      tiers: {
        pod: {
          label: string;
          /**
           * Compute units billed per wall-clock minute of a session on this tier.
           */
          unitsPerMinute: number;
        };
        vm: {
          label: string;
          /**
           * Compute units billed per wall-clock minute of a session on this tier.
           */
          unitsPerMinute: number;
        };
        heavy: {
          label: string;
          /**
           * Compute units billed per wall-clock minute of a session on this tier.
           */
          unitsPerMinute: number;
        };
      };
    };
    /**
     * Default spend caps for an individual account and an organisation.
     */
    limits?: {
      user?: {
        /**
         * Default monthly compute spend cap in minor units; 0 = no cap. Accounts may change their own.
         */
        monthlyCap: number;
        /**
         * At the cap, refuse new paid lab starts (running sessions are never stopped). Off: warn only.
         */
        hardStop?: boolean;
      };
      org?: {
        /**
         * Default monthly compute spend cap in minor units; 0 = no cap. Accounts may change their own.
         */
        monthlyCap: number;
        /**
         * At the cap, refuse new paid lab starts (running sessions are never stopped). Off: warn only.
         */
        hardStop?: boolean;
      };
    };
    /**
     * Failed payments.
     */
    dunning?: {
      /**
       * Days after a failed payment (or a past_due/unpaid subscription) before new paid lab starts are refused.
       */
      graceDays?: number;
    };
    /**
     * Early-access labs (hosted edition only): content not yet public, unlocked by a plan level. Each rule names the plan that unlocks the labs it matches (all given selectors must match; `labs` matches by id on its own); a lab needs the highest plan level among the rules it matches. Public labs match no rule and are never gated by plan. Flag a lab in its own metadata with the tag `early-access` and a rule `{ plan, tags: [early-access] }`. Self-hosted deployments do not gate labs.
     */
    earlyAccess?: {
      /**
       * Plan id; its `level` unlocks the labs.
       */
      plan: string;
      labs?: string[];
      domains?: string[];
      difficulties?: ("easy" | "medium" | "hard")[];
      computeTiers?: ("pod" | "vm" | "heavy")[];
      tags?: string[];
    }[];
    /**
     * Deprecated and ignored: public labs are no longer gated by plan (use `earlyAccess`). The gateway logs a warning when it is set.
     */
    premium?: {
      /**
       * Plan id; its `level` unlocks the labs.
       */
      plan: string;
      labs?: string[];
      domains?: string[];
      difficulties?: ("easy" | "medium" | "hard")[];
      computeTiers?: ("pod" | "vm" | "heavy")[];
      tags?: string[];
    }[];
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
  /**
   * Customer logos and quotes. While `placeholder` is true every slot is labelled as a placeholder; never ship invented quotes as real ones.
   */
  socialProof?: {
    placeholder?: boolean;
    eyebrow?: string;
    title?: string;
    note?: string;
    /**
     * @maxItems 8
     */
    logos?:
      | []
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ]
      | [
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          },
          {
            name: string;
            image?: Href;
            imageDark?: Href;
          }
        ];
    /**
     * @maxItems 6
     */
    quotes?:
      | []
      | [
          {
            quote: string;
            name: string;
            role?: string;
          }
        ]
      | [
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          }
        ]
      | [
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          }
        ]
      | [
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          }
        ]
      | [
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          }
        ]
      | [
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          },
          {
            quote: string;
            name: string;
            role?: string;
          }
        ];
  };
  /**
   * Early-access waitlist: a call-to-action section with a short form on the landing page (POST /api/public/waitlist). Entries are stored in the gateway database; no email is sent. The consent checkbox links to the privacy page (legal.privacy).
   */
  waitlist?: {
    /**
     * Show the waitlist section. Off: no form, and the gateway refuses submissions.
     */
    enabled: boolean;
    eyebrow?: string;
    title?: string;
    body?: string;
    /**
     * Label of the submit button.
     */
    submitLabel?: string;
    emailLabel?: string;
    /**
     * Text of the consent checkbox, before the link to the privacy page.
     */
    consentLabel?: string;
    /**
     * Text of the link to the privacy page inside the consent label.
     */
    privacyLinkLabel?: string;
    /**
     * Small print under the form.
     */
    note?: string;
    successTitle?: string;
    successBody?: string;
    duplicateTitle?: string;
    duplicateBody?: string;
    /**
     * Shown when the submission fails for a reason other than a field error.
     */
    errorMessage?: string;
    /**
     * Optional fields next to the email address.
     */
    fields?: {
      organisation?: {
        /**
         * Show the field.
         */
        enabled?: boolean;
        /**
         * The visitor must fill it in.
         */
        required?: boolean;
        label?: string;
        placeholder?: string;
      };
      role?: {
        /**
         * Show the field.
         */
        enabled?: boolean;
        /**
         * The visitor must fill it in.
         */
        required?: boolean;
        label?: string;
        placeholder?: string;
        /**
         * Choices for a select; absent means free text.
         *
         * @maxItems 12
         */
        options?:
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
          | [string, string, string, string, string, string, string, string, string, string]
          | [string, string, string, string, string, string, string, string, string, string, string]
          | [string, string, string, string, string, string, string, string, string, string, string, string];
      };
      interest?: {
        /**
         * Show the field.
         */
        enabled?: boolean;
        /**
         * The visitor must fill it in.
         */
        required?: boolean;
        label?: string;
        enterpriseLabel?: string;
        individualLabel?: string;
      };
    };
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
  /**
   * Tier level for early-access labs (free 0). A subscriber, or a seated member of an organisation on the plan, may start labs whose early-access rules need this level or less. Default: 0 for free, 1 otherwise.
   */
  level?: number;
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
   * Premium features the plan includes on the hosted edition (docs/licensing-keys.md). Organisation features (sso, scim, audit_export, advanced_analytics, custom_branding) come from the organisation's plan; exam_certificates also from an individual plan. multi_org is a deployment feature and is ignored here.
   */
  features?: (
    "sso" | "scim" | "audit_export" | "advanced_analytics" | "exam_certificates" | "custom_branding" | "multi_org"
  )[];
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
 * What a plan allows. Recorded and displayed; enforcement covers early-access labs, the free trial, payment, dunning and spend caps (docs/billing.md).
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
