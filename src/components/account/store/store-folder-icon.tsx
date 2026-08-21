import { Compass, Link2, MapPin, Monitor, Newspaper, Package, ShoppingBag, Wrench, Zap } from "lucide-react";

/**
 * The Store category icon vocabulary, shared by the client category deck and the
 * header catalogue explorer so the two never disagree about what a folder means.
 *
 * Matched on the captured folder names the Wayfront import actually produced
 * ("GBP Only SEO", "Onpage & Technical SEO", "Backlink Service", ...), with a
 * neutral package mark for anything unrecognised. The icon is decoration only —
 * the folder name and its real count carry the meaning.
 */
export function StoreFolderIcon({ name }: { name: string }) {
  const key = name.trim().toLowerCase();

  if (key.includes("sprint")) return <Zap />;
  if (key.includes("gbp") || key.includes("google business")) return <MapPin />;
  if (key.includes("local")) return <Compass />;
  if (key.includes("ecommerce") || key.includes("e-commerce")) return <ShoppingBag />;
  if (key.includes("onpage") || key.includes("technical")) return <Wrench />;
  if (key.includes("website") || key.includes("web design")) return <Monitor />;
  if (key.includes("press")) return <Newspaper />;
  if (key.includes("backlink") || key.includes("link building")) return <Link2 />;

  return <Package />;
}
