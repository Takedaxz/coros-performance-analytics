export type Theme = "dark" | "light";

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function openFreeMapStyleUrl(theme: Theme): string {
  const style = theme === "light" ? "positron" : "dark";
  return `https://tiles.openfreemap.org/styles/${style}`;
}
