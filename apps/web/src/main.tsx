import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { ThemeProvider } from "./theme";
import { AlertProvider } from "./alerts/AlertProvider";
import App from "./App";
import "./i18n";
import "./styles.css";

const stored = localStorage.getItem("worksphere_theme") ?? "aether";
document.documentElement.setAttribute("data-theme", stored);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AlertProvider>
            <App />
          </AlertProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
