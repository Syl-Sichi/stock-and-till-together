import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { getProductImageUrl } from "@/lib/product-image";

export function ProductImage({
  path,
  className = "h-10 w-10 rounded-md object-cover bg-muted",
  alt = "",
}: {
  path: string | null | undefined;
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProductImageUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) {
    return (
      <div className={`${className} grid place-items-center text-muted-foreground`}>
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  if (!url) return <div className={className} />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
