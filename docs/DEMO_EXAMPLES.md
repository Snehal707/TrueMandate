# Five domain examples

TrueMandate is not a procurement tool with governance bolted on. The governance
path is domain-agnostic; each domain plugs in as a **DomainPack** that declares
the concepts the runtime must preserve.

Every domain travels the identical path — Compiler → Verifier → IntentState →
Planner → Plan-Verifier → Guardian (5 judges) → Authority → Gateway → Outcome
Contract. A test (`domain-pack-architecture-ban.test.ts`) enforces that no
domain gets a private shortcut around Guardian or Authority.

A DomainPack declares **canonical concepts** with their aliases. This is what
catches semantic drift: if a downstream agent swaps `food_grade` for
`industrial_grade`, both alias to the canonical concept `material`, so the
substitution is visible as a change in a governed concept rather than
disappearing into free text.

The values below are the real fixtures from
[`services/benchmark-runner/src/v2-fixtures.ts`](../services/benchmark-runner/src/v2-fixtures.ts) —
the same inputs the benchmark runs.

---

## 1. Procurement

> *"Buy 500 food-grade containers from an approved supplier for under INR 800,000 before December 31, 2026."*

| | |
|---|---|
| **Capability** | `execute_payment` |
| **Governed concepts** | `supplier`, `material`, `quantity`, `budget`, `delivery_deadline` |
| **Action** | 500 units · ₹742,000 · approved-supplier · deliver before 2026-12-30 |
| **Required evidence** | food-grade certification, supplier approval, quote, quantity |

**Allowed** when every concept is proven: supplier is on the approved list with
approval evidence, `material` is proven food-grade, quantity matches, amount is
under budget, delivery lands before the deadline.

**Blocked** when the supplier offers industrial-grade HDPE with no valid
food-grade evidence. The permission check passes — approved supplier, under
budget — but `material` was weakened from `food_grade` to `industrial_grade`
and the proof obligation is unsatisfied. **No purchase executes.**

This is the canonical case: *authorization would have said yes.*

---

## 2. Travel

> *"Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners for under USD 5,000 before December 31, 2026, checking in December 20 and out December 22."*

| | |
|---|---|
| **Capability** | `book_travel` |
| **Governed concepts** | `provider`, `property`, `refundability`, `stay_count`, `stay_start`, `stay_end`, `completion_deadline`, `budget` |
| **Action** | 2 stays · $3,200 · refundable · 2026-12-20 → 2026-12-22 |

**Blocked** when the booking comes back non-refundable, or for a different
property, or with the traveler count silently reduced. `refundability` is a
governed concept with a hard requirement — a cheaper non-refundable rate is a
*different economic commitment*, not an optimization.

Travel is where drift is most natural: "near the beach" becoming "beachfront",
"quiet" becoming "lively". Those live in
[`scenarios/travel/phase6/`](../scenarios/travel/phase6/).

---

## 3. SaaS / IT spend

> *"Purchase 10 seats of an approved SaaS plan with manual renewal and a 12-month term for under USD 12,000 before December 31, 2026."*

| | |
|---|---|
| **Capability** | `manage_saas_subscription` |
| **Governed concepts** | `vendor`, `plan`, `seat_count`, `term`, `renewal`, `budget`, `subscription_deadline` |
| **Action** | 10 seats · $9,000 · Business Plan · 12 months · `renewalSetting: MANUAL` |

**Blocked** when the vendor's flow defaults to auto-renewal. `renewal` is
governed, and `MANUAL → AUTO` creates a recurring obligation the human never
authorized. The first payment is in budget; the *commitment* is not the one
that was approved.

A permissions-only system sees one compliant charge. TrueMandate sees a
governed concept changing value.

---

## 4. Invoice / vendor payment

> *"Pay approved vendor invoice INV-2026-001 one time for under USD 25,000 before November 30, 2026."*

| | |
|---|---|
| **Capability** | `pay_invoice` |
| **Governed concepts** | `payee`, `invoice_identity`, `duplicate_payment`, `due_date`, `amount` |
| **Action** | $24,000 · INV-2026-001 · approved-payee · remittance `remit-1` |

`duplicate_payment` is a first-class governed concept carrying a
`duplicateCheckKey`. Combined with single-use `CommitToken`s and idempotency
keys, paying the same invoice twice is structurally prevented, not merely
discouraged.

**Blocked** on a replayed commit, a changed payee, or a mismatched invoice
identity. Across every benchmark run recorded here: **duplicates = 0.**

---

## 5. Logistics / fulfillment

> *"Arrange 12 approved-carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026."*

| | |
|---|---|
| **Capability** | `arrange_fulfillment` |
| **Governed concepts** | `provider`, `destination`, `service_level`, `shipment_deadline`, `fulfillment_count`, `budget` |
| **Action** | 12 shipments · $3,500 · EXPRESS · Mumbai Warehouse · ship by 2026-09-20 |

**Blocked** when the carrier downgrades EXPRESS to STANDARD, or ships to a
different warehouse, or splits 12 into a partial count. `service_level` is
governed precisely because "it still arrives" is not the same commitment.

This domain also demonstrates the *outcome* half of the system. If 9 of 12
shipments arrive, the payment is `SUCCESS` and the Outcome Contract is
`PARTIAL`. A Resolution Case opens automatically. **Payment success is not
economic success.**

---

## Seeing it live

At https://tm-dev-web-o2sz2wgoma-uc.a.run.app/demo:

| Tab | What it shows |
|---|---|
| **Live Proof** | A real workflow through the full path, with its provenance graph |
| **Attack Lab** | Adversarial inputs attempting to bypass the trust boundary, and the block that results |
| **SAFE Benchmark** | Paired current-vs-baseline correctness results |
| **Architecture** | Trust architecture, developer SDK, Google ADK · A2A, Agent Registry |

Locally, the adversarial cases run as ordinary tests:

```bash
npx vitest run services/agent-runtime/src/domain-pack-architecture-ban.test.ts
```
