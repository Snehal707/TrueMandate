# Cloud Security Boundaries (Phase 12)

1. **LLMs reason. Infrastructure authorizes.** Gemini/ADK never authorize or execute privileged economic actions.
2. **Data may cross the trust boundary. Authority may not.** External content / Armor CLEAN ≠ create or clear authority/taint.
3. **Model Armor unavailable ≠ safe.** Fail closed; emit `security.model_armor.unavailable`.
4. **CLEAN does not clear taint.** Inspection results are evidence, not privilege.
5. **Public BFF** may create Intent, read workspace, submit ApprovalArtifact, read allowed evidence — nothing else privileged.
6. **Gateway** is private S2S only.
7. **Benchmark-runner** has no production economic authority.
8. **Secrets** live in Secret Manager; no SA JSON keys in containers or frontend.
9. **Identities** distinguish HUMAN | CLOUD_SA | AGENT | DELEGATED_CAPABILITY.
10. **Cloud Trace ≠ Intent Provenance Graph.**
