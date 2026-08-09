import { useCallback } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "../lib/utils";
import { useTheme } from "./theme-provider";

export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const toggleTheme = useCallback(() => {
    const isDark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(isDark ? "light" : "dark");
  }, [setTheme, theme]);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
      className={cn(
        "relative grid size-7 place-items-center rounded-lg border border-border bg-background outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <Sun className="size-[15px] scale-100 rotate-0 dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-[15px] scale-0 rotate-90 dark:scale-100 dark:rotate-0" />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
