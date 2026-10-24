// Claim codes for printed labels, kept in this browser only (the server stores just their hashes).
export const labelStore = {
  get(batch: string): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem("ug.labels." + batch) ?? "{}");
    } catch {
      return {};
    }
  },
  add(batch: string, codes: Record<string, string>) {
    try {
      localStorage.setItem("ug.labels." + batch, JSON.stringify({ ...labelStore.get(batch), ...codes }));
    } catch {
      /* storage full or blocked: the codes are still shown on screen once */
    }
  },
};
