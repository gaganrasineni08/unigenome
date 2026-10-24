// A random id for this phone, so repeat scans and complaints can be counted without an account.
export function deviceId(): string {
  try {
    let id = localStorage.getItem("ug.device");
    if (!id) {
      id = "dev-" + crypto.getRandomValues(new Uint32Array(2)).join("");
      localStorage.setItem("ug.device", id);
    }
    return id;
  } catch {
    return "dev-ephemeral";
  }
}
