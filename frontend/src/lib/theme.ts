export type Theme = "dark" | "light";

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function cartoBasemapUrl(theme: Theme): string {
  const style = theme === "light" ? "light_all" : "dark_all";
  return `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
}
