import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OriginalRequestCard } from "./LiveDemoPage";
import {
  buildLiveDemoWorkflowRequest,
  LIVE_DEMO_DOMAINS,
  type LiveDemoDomainId,
} from "./liveDemoPresets";

/**
 * The rendered "Original request" must be the submitted text, exactly.
 *
 * These assertions are equality, not containment: a summary, a shortened label,
 * or a reconstruction from downstream artifacts would each pass a `contains`
 * check while being precisely the failure this card exists to prevent.
 */

type CardProps = Parameters<typeof OriginalRequestCard>[0];

/** Pull the primary blockquote body out of the rendered card. */
function requestHtml(html: string): string {
  const match = /<blockquote class="tm-request-text">([\s\S]*?)<\/blockquote>/.exec(html);
  return (match?.[1] ?? "").replaceAll("<!-- -->", "");
}

/** Reverse React's HTML escaping. `&amp;` must go last or `&amp;lt;` double-decodes. */
function decode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function requestText(html: string): string {
  return decode(requestHtml(html));
}

function runFor(domainId: LiveDemoDomainId, overrides: Record<string, unknown> = {}): CardProps["run"] {
  return {
    createdAt: "2026-08-27T12:00:00.000Z",
    domainId,
    request: buildLiveDemoWorkflowRequest(domainId),
    workflow: { workflowId: "wf-original-request-001", state: "BLOCKED" },
    evidenceSubmissions: [],
    ...overrides,
  } as unknown as CardProps["run"];
}

function render(run: CardProps["run"]): string {
  return renderToString(<OriginalRequestCard run={run} />);
}

function rawTextOf(domainId: LiveDemoDomainId, rawText?: string): string {
  const intent = buildLiveDemoWorkflowRequest(domainId, rawText === undefined ? {} : { rawText }).intent;
  if (intent.kind !== "RAW") throw new Error(`${domainId} template did not submit raw text`);
  return intent.rawText;
}

describe("original request renders the submitted text exactly", () => {
  const predefined = LIVE_DEMO_DOMAINS.filter((domain) => domain.id !== "custom_intent");

  it("covers all five predefined domains", () => {
    expect(predefined).toHaveLength(5);
  });

  for (const domain of predefined) {
    it(`${domain.label} renders the request text its template actually submits`, () => {
      const submitted = rawTextOf(domain.id);
      const rendered = requestText(render(runFor(domain.id)));

      expect(rendered).toBe(submitted);

      // Not a generic label standing in for the request.
      expect(rendered).not.toBe(domain.label);
      expect(rendered).not.toBe(`${domain.label} workflow`);
      expect(rendered).not.toBe(domain.summary);
      expect(rendered.length).toBeGreaterThan(domain.label.length);
    });
  }

  it("renders custom text verbatim, including punctuation, casing, and symbols", () => {
    const custom = 'Pay INVOICE #77-b to "Approved Payee" & co — under USD 24,000 (<30 Nov).';
    const request = buildLiveDemoWorkflowRequest("custom_intent", {
      customPackId: "invoice_vendor_payment",
      rawText: custom,
    });
    expect(request.intent.kind === "RAW" ? request.intent.rawText : undefined).toBe(custom);

    const html = render(
      runFor("custom_intent", { request, customPackId: "invoice_vendor_payment" }),
    );
    expect(requestText(html)).toBe(custom);
  });
});

describe("the source of the request text is stated honestly", () => {
  const domain: LiveDemoDomainId = "travel";
  const submitted = rawTextOf(domain);

  const withWorkspace = (rawIntent: string, constraints: readonly unknown[] = []) =>
    runFor(domain, { workspace: { summary: { rawIntent }, semantic: { constraints } } });

  it("says submitted-this-session when no workspace has been read back", () => {
    const html = render(runFor(domain));
    expect(html).toContain("Submitted in this session");
    expect(html).not.toContain("Confirmed by the recorded intent");
    expect(requestText(html)).toBe(submitted);
  });

  it("says confirmed when the backend recorded the same text", () => {
    const html = render(withWorkspace(submitted));
    expect(html).toContain("Confirmed by the recorded intent");
    expect(html).not.toContain("Submitted in this session");
    expect(requestText(html)).toBe(submitted);
  });

  it("shows both texts when they diverge, rather than silently preferring one", () => {
    const html = render(withWorkspace("A different recorded intent."));

    expect(html).toContain("Submitted text differs from the recorded intent");
    // The text this client actually submitted stays primary.
    expect(requestText(html)).toBe(submitted);
    // And the divergent recorded text is shown too, separately labelled.
    expect(html).toContain("Recorded intent returned by the backend");
    expect(html).toContain("A different recorded intent.");
  });

  it("never claims a REFERENCE intent was submitted from this session", () => {
    const html = render(
      runFor(domain, {
        request: {
          ...buildLiveDemoWorkflowRequest(domain),
          intent: { kind: "REFERENCE", intentId: "intent-1" },
        },
        workspace: { summary: { rawIntent: "Recorded only." }, semantic: { constraints: [] } },
      }),
    );

    expect(html).toContain("not submitted from this session");
    expect(html).not.toContain("Submitted in this session");
    expect(requestText(html)).toBe("Recorded only.");
  });

  it("states plainly when no request text exists at all", () => {
    const html = render(
      runFor(domain, {
        request: {
          ...buildLiveDemoWorkflowRequest(domain),
          intent: { kind: "REFERENCE", intentId: "intent-1" },
        },
      }),
    );

    expect(html).toContain("No human request text is available");
    expect(html).toContain("Nothing is inferred from");
    expect(requestHtml(html)).toBe("");
  });
});

describe("verified interpretation stays distinct from the request", () => {
  const domain: LiveDemoDomainId = "procurement";
  const submitted = rawTextOf(domain);

  it("labels the interpretation separately and keeps it out of the request element", () => {
    const html = render(
      runFor(domain, {
        workspace: {
          summary: { rawIntent: submitted },
          semantic: {
            constraints: [
              { id: "c1", concept: "material", operator: "EQUALS", expectedValue: "food_grade", criticality: "CRITICAL" },
              { id: "c2", concept: "quantity", operator: "EQUALS", expectedValue: 500, criticality: "CRITICAL" },
            ],
          },
        },
      }),
    );

    expect(html).toContain("Verified interpretation");
    expect(html).toContain("2 constraints extracted");
    expect(html).toContain("not the human");

    // The request element carries the human wording and nothing else.
    expect(requestText(html)).toBe(submitted);
    expect(requestHtml(html)).not.toContain("food_grade");
    expect(requestHtml(html)).not.toContain("CRITICAL");
  });

  it("reports absence rather than fabricating an interpretation", () => {
    const html = render(runFor(domain));
    expect(html).toContain("Not returned yet");
    expect(html).toContain("No public constraint set has been returned");
    expect(html).not.toContain("constraints extracted");
  });
});
