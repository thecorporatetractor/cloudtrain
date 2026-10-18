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
 * via the `definition` "email".
 */
export type Email = string;

/**
 * Configuration of the public website served by the same web app as the platform (apps/web) and the gateway (`GET /api/public/site`). Brand, copy, feature blocks, FAQ, contact, footer, legal placeholders, highlighted domains, theme token overrides, feature flags and plans. The default lives in content/site.yaml; a deployment replaces it with its own file (CT_SITE_CONFIG, e.g. a ConfigMap mount) without a code change.
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
   * Value-proposition blocks on the landing page.
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
        },
        {
          title: string;
          body: string;
        }
      ]
    | [
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        }
      ]
    | [
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        }
      ]
    | [
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        }
      ]
    | [
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        },
        {
          title: string;
          body: string;
        }
      ];
  /**
   * @maxItems 8
   */
  screenshots?:
    | []
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        }
      ]
    | [
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
        },
        {
          /**
           * Absolute path served by the web app (the default `/site/<name>.png` files are copies of README screenshots kept by apps/web/scripts/readme-shots.mjs) or a URL.
           */
          image: string;
          alt: string;
          caption?: string;
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
    },
    ...{
      q: string;
      a: string;
      /**
       * Optional heading the question is listed under.
       */
      group?: string;
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
  };
  /**
   * Pricing page copy. Plans arrive in a later schema version.
   */
  pricing?: {
    headline?: string;
    intro?: string;
    /**
     * Shown while prices are placeholders.
     */
    placeholderNote?: string;
    contactCta?: Cta;
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
    | "eye";
  title: string;
  body: string;
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
