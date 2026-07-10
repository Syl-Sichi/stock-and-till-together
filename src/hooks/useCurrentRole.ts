import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "manager" | "cashier";

export function useCurrentRole() {
  return useQuery({
    queryKey: ["current-role"],
    queryFn: async (): Promise<AppRole> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return "cashier";
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const roles = (data ?? []).map((r) => r.role as AppRole);
      if (roles.includes("owner")) return "owner";
      if (roles.includes("manager")) return "manager";
      return "cashier";
    },
    staleTime: 60_000,
  });
}
