import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./demo/DemoApp";
import "./demo/demo-v2.css";
import "./demo/semantic-color.css";
import "./demo/architecture-visual.css";
import "./demo/qualification.css";
import "./demo/attack-lab-polish.css";
import "./demo/final-pass.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
