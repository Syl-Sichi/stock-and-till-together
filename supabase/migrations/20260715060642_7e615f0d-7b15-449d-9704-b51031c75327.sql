DROP TRIGGER IF EXISTS products_low_stock ON public.products;
DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;

CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hook_url TEXT;
  api_key  TEXT;
  was_low  BOOLEAN;
BEGIN
  IF NEW.quantity <= NEW.min_stock THEN
    was_low := (TG_OP = 'UPDATE' AND OLD.quantity <= COALESCE(OLD.min_stock, 0));
    IF TG_OP = 'INSERT'
       OR NOT was_low
       OR NEW.quantity < OLD.quantity
       OR NEW.min_stock <> OLD.min_stock
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
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_notify_low_stock
AFTER INSERT OR UPDATE OF quantity, min_stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();