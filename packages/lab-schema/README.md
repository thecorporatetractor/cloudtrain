# @cloudtrain/lab-schema

The `cloudtrain.dev/v3` Lab contract: `schema/lab.schema.json` (JSON Schema 2020-12), TypeScript types generated from it (`src/types.generated.ts`) and a `validateLab()` function (ajv).

```ts
import { validateLab, type Lab } from "@cloudtrain/lab-schema";
const { valid, issues } = validateLab(parsedYaml);
```

After editing the schema run `pnpm --filter @cloudtrain/lab-schema build` (regenerates types, compiles) and commit `src/types.generated.ts`.
