// SPDX-License-Identifier: MulanPSL-2.0
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "tdesign-react/es/_util/react-19-adapter";
import "./index.css";
import App from "./App.tsx";
import { initializeTheme } from "./theme";

initializeTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
