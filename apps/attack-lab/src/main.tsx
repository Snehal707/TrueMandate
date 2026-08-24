import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AttackLabPage } from "../../web/src/demo/AttackLabPage";
import "../../web/src/demo/demo-v2.css";

/**
 * Standalone deployment entry for the product Attack Lab.
 * The implementation is shared with the primary web surface so neither entry
 * can drift into a prerecorded or fabricated governance comparison.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="tm-v2">
      <AttackLabPage />
    </main>
  </StrictMode>,
);
