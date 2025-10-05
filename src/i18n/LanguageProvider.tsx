"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import enMessages from "./messages/en.json";
import frMessages from "./messages/fr.json";

export type AppLocale = "en" | "fr";

type LocaleContextType = {
  locale: AppLocale;
  setLocale: (loc: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

// Synchronous messages to prevent MISSING_MESSAGE during initial render
const EN_MESSAGES: AbstractIntlMessages = enMessages as unknown as AbstractIntlMessages;
const FR_MESSAGES: AbstractIntlMessages = frMessages as unknown as AbstractIntlMessages;
const MESSAGES: Record<AppLocale, AbstractIntlMessages> = { en: EN_MESSAGES, fr: FR_MESSAGES };

function getMessages(locale: AppLocale): AbstractIntlMessages {
  return MESSAGES[locale];
}

function pickBrowserLocale(): AppLocale {
  if (typeof navigator !== "undefined") {
    const nav = navigator.language || "";
    if (nav.toLowerCase().startsWith("fr")) return "fr";
  }
  return "en";
}

export function useLocaleController() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocaleController must be used within LanguageProvider");
  return ctx;
}

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const initialLocale: AppLocale = (() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("neil:locale");
      if (saved === "en" || saved === "fr") return saved as AppLocale;
      const isFr = window.navigator?.language?.toLowerCase().startsWith("fr");
      return isFr ? "fr" : "en";
    }
    return pickBrowserLocale();
  })();

  const [locale, setLocale] = useState<AppLocale>(initialLocale);
  const [messages, setMessages] = useState<AbstractIntlMessages>(() => getMessages(initialLocale));

  useEffect(() => {
    setMessages(getMessages(locale));
    try {
      if (typeof document !== "undefined") document.documentElement.lang = locale;
      if (typeof window !== "undefined") window.localStorage.setItem("neil:locale", locale);
    } catch {}
  }, [locale]);

  const ctx = useMemo(() => ({ locale, setLocale }), [locale]);

  // Render children with messages; messages are available synchronously
  return (
    <LocaleContext.Provider value={ctx}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
