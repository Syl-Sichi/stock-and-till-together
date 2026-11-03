import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Users, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/staff")({
  component: StaffPage,
});

type StaffMember = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "owner" | "manager" | "cashier" | null;
};

function StaffPage() {
  const { data: myRole } = useCurrentRole();
  const qc = useQueryClient();

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: async (): Promise<StaffMember[]> => {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, full_name");
      if (pErr) throw pErr;

      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rErr) throw rErr;

      const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r.role]));

      return (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        role: roleMap.get(p.id) ?? null,
      }));
    },
    enabled: myRole === "owner",
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      // Remove existing roles then insert the new one
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Role updated");
    },
    onError: (e: any) => toast.error(e.message || "Failed to update role"),
  });

  if (myRole !== "owner") {
    return (
      <div className="max-w-lg mx-auto mt-12 text-center">
        <Shield className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">Only the owner can manage staff.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          Staff
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          You are the developer. Create the real owner's account, then set them as Owner here.
          You can keep yourself as Owner too, or change your role later.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to add a staff member</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>1. Share the app link with the real owner (or create their account yourself).</p>
          <p>2. They sign up with their email and password.</p>
          <p>3. Come back here and set their role to <strong>Owner</strong>.</p>
          <p>4. Optionally change your own role if you no longer need owner access.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current users</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="space-y-3">
              {staff.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center justify-between gap-4 py-3 border-b last:border-0"
                >
                  <div>
                    <div className="font-medium">
                      {person.full_name || person.email || "Unnamed"}
                    </div>
                    <div className="text-xs text-muted-foreground">{person.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {person.role === "owner" ? (
                      <Badge>Owner</Badge>
                    ) : (
                      <Select
                        value={person.role || "cashier"}
                        onValueChange={(role) =>
                          setRole.mutate({ userId: person.id, role })
                        }
                        disabled={setRole.isPending}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="cashier">Cashier</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
