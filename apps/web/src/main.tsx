import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./demo/DemoApp";
import "./demo/demo-v2.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
