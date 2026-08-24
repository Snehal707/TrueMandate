import type {
  SafeDomain,
  SafeFamily,
  SafeScenario,
  SafeSplit,
} from "./scenario-schema.js";
import { SafeScenarioSchema } from "./scenario-schema.js";

export interface RegistryFilter {
  readonly split?: SafeSplit | readonly SafeSplit[];
  readonly domain?: SafeDomain | readonly SafeDomain[];
  readonly family?: SafeFamily | readonly SafeFamily[];
  readonly ids?: readonly string[];
}

function matchesList<T extends string>(
  value: T,
  filter: T | readonly T[] | undefined,
): boolean {
  if (filter === undefined) return true;
  return Array.isArray(filter) ? filter.includes(value) : filter === value;
}

export class ScenarioRegistry {
  private readonly byId = new Map<string, SafeScenario>();

  constructor(scenarios: readonly SafeScenario[] = []) {
    this.load(scenarios);
  }

  load(scenarios: readonly SafeScenario[]): void {
    for (const raw of scenarios) {
      const parsed = SafeScenarioSchema.parse(raw);
      this.byId.set(parsed.id, parsed);
    }
  }

  get(id: string): SafeScenario | undefined {
    return this.byId.get(id);
  }

  list(filter: RegistryFilter = {}): SafeScenario[] {
    const out: SafeScenario[] = [];
    for (const s of this.byId.values()) {
      if (!matchesList(s.split, filter.split)) continue;
      if (!matchesList(s.domain, filter.domain)) continue;
      if (!matchesList(s.family, filter.family)) continue;
      if (filter.ids && !filter.ids.includes(s.id)) continue;
      out.push(s);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  size(): number {
    return this.byId.size;
  }
}
