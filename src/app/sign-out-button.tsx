"use client";

import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);

    // Sai das duas entradas: o cookie da senha de administrador (só o servidor apaga) e a sessão do Supabase.
    const admin = await fetch("/api/admin/logout", { method: "POST" }).then((response) => response.ok, () => false);
    const { error } = await supabase.auth.signOut().catch((caught: unknown) => ({ error: caught }));
    if (!admin && error) {
      setLoading(false);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      className="group/menu-button flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50"
      type="button"
      onClick={signOut}
      disabled={loading}
      title="Sair"
      aria-busy={loading}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <LogOut className="size-4 shrink-0" />}
      <span className="truncate">{loading ? "Saindo..." : "Sair"}</span>
    </button>
  );
}
