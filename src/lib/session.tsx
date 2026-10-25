// Who is signed in. The decrypted private key stays in this browser tab only (sessionStorage);
// the server never receives it.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { signMessage } from "../../shared/crypto";
import { decryptSecretKey } from "../../shared/keystore";
import { api } from "./api";

export interface Party {
  id: string;
  name: string;
  role: "regulator" | "manufacturer" | "qa" | "warehouse" | "retailer";
  org: string | null;
  status: string;
}

export interface Me extends Party {
  publicKey: string;
  reviewNote?: string | null;
  sites: Array<{ id: string; name: string; lat: number; lng: number }>;
}

interface SessionValue {
  me: Me | null;
  secretKey: string | null;
  loading: boolean;
  signIn(handle: string, passphrase: string): Promise<Me>;
  signOut(): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<SessionValue>(null as any);

const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v);
    } catch {
      /* private mode: stays in memory only */
    }
  },
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(store.get("ug.sk"));
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!store.get("ug.token")) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>("/me"));
    } catch {
      store.set("ug.token", null);
      store.set("ug.sk", null);
      setMe(null);
      setSecretKey(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const signIn = async (handle: string, passphrase: string) => {
    const ch = await api<{ partyId: string; encKey: any; nonce: string }>("/auth/challenge", { body: { handle: handle.trim().toLowerCase() }, auth: false });
    let sk: string;
    try {
      sk = await decryptSecretKey(ch.encKey, passphrase);
    } catch {
      throw new Error("Wrong passphrase");
    }
    const sig = signMessage("UG/login", { nonce: ch.nonce, party: ch.partyId }, sk);
    const r = await api<{ token: string }>("/auth/login", { body: { partyId: ch.partyId, nonce: ch.nonce, sig }, auth: false });
    store.set("ug.token", r.token);
    store.set("ug.sk", sk);
    setSecretKey(sk);
    const m = await api<Me>("/me");
    setMe(m);
    return m;
  };

  const signOut = () => {
    store.set("ug.token", null);
    store.set("ug.sk", null);
    setMe(null);
    setSecretKey(null);
  };

  return <Ctx.Provider value={{ me, secretKey, loading, signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
