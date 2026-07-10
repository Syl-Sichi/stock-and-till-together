import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatNaira } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Download } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/reports")({
  component: Reports;
});

type Period = "day" | "week" | "month";
