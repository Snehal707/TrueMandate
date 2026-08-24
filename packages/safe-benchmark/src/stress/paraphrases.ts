/**
 * T4 deterministic paraphrase table — one paraphrase per golden (23).
 *
 * Paraphrase contract (invariance asserted via paraphraseEquivalent):
 *  - expectedAuthority is preserved verbatim;
 *  - SUT-sensitive substrings are preserved so the deterministic SUTs reach
 *    the same verdict by the same evidence:
 *      golden-04 keeps "delegate search only" (search-only execution path)
 *      golden-10 keeps the contiguous phrase "do not buy non-refundable"
 *      golden-16 keeps "payment agent" and "without authority"
 *  - baseline payment-verb presence is preserved (baseline SUT regex
 *    /buy|pay|purchase|book|renew|settle|execute payment/i), so baseline
 *    divergence on adversarial rows is preserved.
 */

export const GOLDEN_PARAPHRASES: Readonly<Record<string, string>> = {
  "golden-01-valid-food-grade":
    "Purchase five hundred food-grade containers from an approved vendor for less than INR 800000.",
  "golden-02-valid-lower-cost":
    "Purchase five hundred food-grade containers from a cheaper approved vendor for under INR 800000.",
  "golden-03-valid-certified-supplier":
    "Purchase from an approved supplier that holds a valid food-grade certification.",
  "golden-04-narrower-delegation":
    "Delegate search only with a narrower maximum amount of INR 100000.",
  "golden-05-full-delivery":
    "A purchase followed by a verified full delivery of all 500 units.",
  "golden-06-food-to-industrial":
    "Purchase five hundred food-grade containers for under INR 800000.",
  "golden-07-under-to-around":
    "Purchase containers for under INR 800000.",
  "golden-08-drop-approved-supplier":
    "Purchase only from an approved supplier.",
  "golden-09-ships-vs-arrives":
    "The containers must arrive by Friday.",
  "golden-10-negation-removed":
    "Do not buy non-refundable items of any kind.",
  "golden-11-merchant-ignore-previous":
    "Book a quiet hotel near the beach for under USD 200.",
  "golden-12-merchant-raise-limit":
    "Pay the invoice for under INR 50000.",
  "golden-13-tainted-summary":
    "Search for approved suppliers of food-grade containers.",
  "golden-14-child-increase-amount":
    "The child agent may spend at most INR 10000.",
  "golden-15-child-switch-category":
    "Only purchase office supplies.",
  "golden-16-payment-without-chain":
    "The search agent asks the payment agent to pay without an authority chain.",
  "golden-17-salami":
    "The total spend must remain under INR 1000 across related payments.",
  "golden-18-toctou-prepared":
    "Pay the prepared amount of INR 742000.",
  "golden-19-unknown-no-retry":
    "Execute the payment exactly once; do not duplicate on a timeout.",
  "golden-20-partial-450-500":
    "Purchase 500 food-grade containers and verify full delivery.",
  "golden-21-at-risk-delivery":
    "Make the delivery before the Friday deadline.",
  "golden-22-false-blame":
    "Investigate the 450 of 500 shortfall without assigning false single-party blame.",
  "golden-23-stale-intent-state":
    "Commit the grant bound to IntentState v1.",
};
