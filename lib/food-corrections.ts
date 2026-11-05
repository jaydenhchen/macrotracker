export function isPlainGreekYogurtName(name: string): boolean {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === "plain greek yogurt";
}
