import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ru from "./locales/ru.json";

const stored = localStorage.getItem("worksphere_locale");
const lng = stored === "ko" ? "en" : stored ?? "en";
if (stored === "ko") localStorage.setItem("worksphere_locale", "en");

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ru: { translation: ru },
  },
  lng,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
