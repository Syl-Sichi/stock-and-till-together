
-- Push subscriptions
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subs read"   ON public.push_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own subs insert" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own subs delete" ON public.push_subscriptions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Notification dedupe log
CREATE TABLE public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,           -- 'low_stock' | 'daily_report'
  ref TEXT NOT NULL,            -- product_id or yyyy-mm-dd
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);
GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "log read" ON public.notification_log FOR SELECT TO authenticated USING (true);

-- Client ref on sales for idempotent offline replay
ALTER TABLE public.sales     ADD COLUMN IF NOT EXISTS client_ref TEXT UNIQUE;
ALTER TABLE public.products  ADD COLUMN IF NOT EXISTS client_ref TEXT UNIQUE;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS client_ref TEXT UNIQUE;

-- updated_at on suppliers (needed for conflict resolution)
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS suppliers_touch ON public.suppliers;
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Low-stock trigger: notify via pg_net when quantity crosses <= min_stock
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hook_url TEXT;
  api_key  TEXT;
BEGIN
  IF NEW.quantity <= NEW.min_stock
     AND (TG_OP = 'INSERT' OR OLD.quantity > OLD.min_stock OR NEW.min_stock <> OLD.min_stock)
  THEN
    SELECT decrypted_secret INTO hook_url FROM vault.decrypted_secrets WHERE name = 'PUSH_HOOK_URL' LIMIT 1;
    SELECT decrypted_secret INTO api_key  FROM vault.decrypted_secrets WHERE name = 'PUSH_HOOK_APIKEY' LIMIT 1;
    IF hook_url IS NOT NULL AND api_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := hook_url,
        headers := jsonb_build_object('Content-Type','application/json','apikey', api_key),
        body := jsonb_build_object('product_id', NEW.id, 'name', NEW.name, 'quantity', NEW.quantity, 'min_stock', NEW.min_stock)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_low_stock ON public.products;
CREATE TRIGGER products_low_stock AFTER INSERT OR UPDATE OF quantity, min_stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();
