import { describe, expect, it } from "vitest";
import {
  InMemorySecurityEventBus,
  SecurityEventType,
  createSecurityEvent,
} from "./security-events.js";

describe("security event bus", () => {
  it("records model armor unavailable as CRITICAL first-class event", () => {
    const bus = new InMemorySecurityEventBus();
    bus.emit(
      createSecurityEvent({
        type: SecurityEventType.MODEL_ARMOR_UNAVAILABLE,
        actorService: "agent-runtime",
        severity: "CRITICAL",
        correlationId: "corr-1",
        details: { reason: "armor_timeout" },
      }),
    );
    const events = bus.list();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(SecurityEventType.MODEL_ARMOR_UNAVAILABLE);
    expect(events[0]!.severity).toBe("CRITICAL");
  });
});
