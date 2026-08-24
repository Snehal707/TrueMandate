import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const matrixPath = path.join(root, "docs/architecture/iam-matrix.json");
const runtimeMain = path.join(
  root,
  "infrastructure/terraform/modules/runtime/main.tf",
);
const runtimeVars = path.join(
  root,
  "infrastructure/terraform/modules/runtime/variables.tf",
);

function extractHclBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing HCL block marker: ${marker}`);
  const openIndex = source.indexOf("{", markerIndex);
  if (openIndex < 0) throw new Error(`Missing opening brace after: ${marker}`);

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  throw new Error(`Missing closing brace after: ${marker}`);
}

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("cloud IAM forbidden relationships", () => {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8")) as {
    invokerGraph: Record<string, string[]>;
    forbiddenInvokerEdges: Array<{ from: string; to: string }>;
    publicAccess: {
      gateway: { ingress: string; cloudRunInvokerAllowedFrom: string[] };
      "public-bff": { cloudRunInvoker: string[] };
      web: { cloudRunInvoker: string[] };
    };
    serviceAccounts: Record<
      string,
      {
        forbiddenCapabilities: string[];
        firestore: string[];
        invoke: string[];
        secrets: string[];
      }
    >;
  };

  it("forbids non-authority callers from invoking gateway", () => {
    for (const edge of matrix.forbiddenInvokerEdges) {
      if (edge.to !== "gateway") continue;
      const allowed = matrix.invokerGraph[edge.from] ?? [];
      expect(allowed.includes("gateway"), `${edge.from}→gateway`).toBe(false);
    }
    expect(matrix.invokerGraph.authority).toContain("gateway");
    expect(matrix.publicAccess.gateway.cloudRunInvokerAllowedFrom).toEqual([
      "authority",
    ]);
  });

  it("keeps public-bff without allUsers invoker", () => {
    expect(matrix.publicAccess["public-bff"].cloudRunInvoker).toEqual([]);
  });

  it("gives web allUsers but no firestore/secrets privileges in matrix", () => {
    expect(matrix.publicAccess.web.cloudRunInvoker).toContain("allUsers");
    expect(matrix.serviceAccounts.web.firestore).toEqual([]);
    expect(matrix.serviceAccounts.web.secrets).toEqual([]);
    expect(matrix.serviceAccounts.web.invoke).toEqual(["public-bff"]);
    expect(
      matrix.serviceAccounts.web.forbiddenCapabilities,
    ).toContain("gateway.commit");
  });

  it("benchmark has no production economic authority and no gateway invoke", () => {
    expect(matrix.serviceAccounts["benchmark-runner"].invoke).toEqual([]);
    expect(
      matrix.serviceAccounts["benchmark-runner"].forbiddenCapabilities,
    ).toContain("productionEconomicAuthority");
  });

  it("terraform runtime module keeps gateway INTERNAL_ONLY and no public-bff allUsers", () => {
    const main = readFileSync(runtimeMain, "utf8");
    const vars = readFileSync(runtimeVars, "utf8");
    expect(vars).toMatch(/gateway[\s\S]*INGRESS_TRAFFIC_INTERNAL_ONLY/);
    expect(main).toMatch(/web_public[\s\S]*allUsers/);
    expect(main).not.toMatch(
      /public-bff[\s\S]{0,200}member\s*=\s*"allUsers"/,
    );
    // Forbidden edges must not appear as invoker from public-bff to gateway
    expect(vars).not.toMatch(/public-bff->gateway/);
    expect(vars).toMatch(/authority->gateway/);
    expect(vars).toMatch(/web->public-bff/);
    expect(vars).not.toMatch(/web->gateway/);
  });

  it("isolates public-bff governed commit from raw execution", () => {
    const main = readFileSync(runtimeMain, "utf8");
    expect(occurrences(main, 'name  = "TM_WORKFLOW_COMMIT_CALLER_EMAILS"')).toBe(1);
    expect(main).toMatch(
      /name\s*=\s*"TM_WORKFLOW_COMMIT_CALLER_EMAILS"[\s\S]{0,120}service_account_emails\["public-bff"\]/,
    );
    const executionCallerBlock = main.match(
      /name\s*=\s*"TM_EXECUTION_CALLER_EMAIL"[\s\S]*?\n\s*}\n\s*}/,
    )?.[0];
    expect(executionCallerBlock).toContain('service_account_emails["phase-b-verifier"]');
    expect(executionCallerBlock).toContain('service_account_emails["phase-c-verifier"]');
    expect(executionCallerBlock).not.toContain('service_account_emails["public-bff"]');
  });

  it("renders learning-service internal auth from one canonical source", () => {
    const main = readFileSync(runtimeMain, "utf8");
    const vars = readFileSync(runtimeVars, "utf8");
    const serviceEnv = extractHclBlock(vars, "service_env = {");
    const learningEnv = extractHclBlock(serviceEnv, "learning-service = {");

    for (const name of [
      "TM_REQUIRE_INTERNAL_AUTH",
      "TM_INTERNAL_AUTH_VERIFY",
      "TM_INTERNAL_AUTH_AUDIENCE",
      "TM_INTERNAL_ALLOWED_CALLERS",
    ]) {
      expect(occurrences(learningEnv, name), name).toBe(1);
    }
    expect(occurrences(learningEnv, 'service_account_emails["phase-c-verifier"]')).toBe(1);
    expect(occurrences(learningEnv, 'service_account_emails["authority"]')).toBe(1);
    expect(learningEnv).not.toContain('service_account_emails["public-bff"]');
    expect(main).not.toMatch(/each\.key == "learning-service"/);
  });

  it("keeps Public BFF outcome access read-only at the application policy", () => {
    const main = readFileSync(runtimeMain, "utf8");
    expect(occurrences(main, "TM_OUTCOME_READER_CALLER_EMAILS")).toBe(1);
    expect(main).toMatch(
      /name\s*=\s*"TM_OUTCOME_READER_CALLER_EMAILS"[\s\S]{0,120}service_account_emails\["public-bff"\]/,
    );
    const outcomeGlobalPolicy = main.match(
      /name\s*=\s*"TM_INTERNAL_ALLOWED_CALLERS"[\s\S]{0,300}service_account_emails\["gateway"\][\s\S]*?\n\s*}\n\s*}/,
    )?.[0];
    expect(outcomeGlobalPolicy).toBeDefined();
    expect(outcomeGlobalPolicy).not.toContain('service_account_emails["public-bff"]');
  });

  it("forbidden edges are absent from invokerGraph", () => {
    for (const edge of matrix.forbiddenInvokerEdges) {
      const targets = matrix.invokerGraph[edge.from] ?? [];
      expect(targets.includes(edge.to), JSON.stringify(edge)).toBe(false);
    }
  });
});
