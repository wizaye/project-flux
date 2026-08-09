import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from "react";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  theme: Theme;
  onThemeChange?: (theme: Theme) => void;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

function applyTheme(theme: Theme) {
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.classList.toggle("light", resolvedTheme === "light");
}

export function ThemeProvider({ children, theme, onThemeChange }: ThemeProviderProps) {
  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = () => applyTheme(theme);

    applySystemTheme();
    if (theme === "system") mediaQuery.addEventListener("change", applySystemTheme);

    return () => mediaQuery.removeEventListener("change", applySystemTheme);
  }, [theme]);

  const value = useMemo<ThemeProviderState>(
    () => ({
      theme,
      setTheme: (nextTheme) => {
        if (nextTheme !== theme) onThemeChange?.(nextTheme);
      },
    }),
    [onThemeChange, theme]
  );

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
