import { UserRole } from "../types";

export type AppNavigationIcon =
  | "market"
  | "orders"
  | "cart"
  | "account"
  | "dashboard"
  | "products"
  | "farm"
  | "events"
  | "promotions"
  | "growth";

export type AppNavigationItem = {
  to: string;
  label: string;
  shortLabel: string;
  icon: AppNavigationIcon;
};

export const navigationItemsForRole = (
  role: UserRole
): AppNavigationItem[] =>
  role === UserRole.PRODUCER
    ? [
        { to: "/producer?view=overview", label: "Overview", shortLabel: "Home", icon: "dashboard" },
        { to: "/producer?view=products", label: "Products", shortLabel: "Products", icon: "products" },
        { to: "/producer?view=orders", label: "Orders", shortLabel: "Orders", icon: "orders" },
        { to: "/events", label: "Events", shortLabel: "Events", icon: "events" },
        { to: "/producer/growth", label: "Promotion & partners", shortLabel: "Grow", icon: "growth" },
        { to: "/producer?view=farm", label: "Farm profile", shortLabel: "Farm", icon: "farm" },
        { to: "/account", label: "Account & safety", shortLabel: "Account", icon: "account" },
      ]
    : [
        { to: "/buyer", label: "Marketplace", shortLabel: "Market", icon: "market" },
        { to: "/events", label: "Events", shortLabel: "Events", icon: "events" },
        { to: "/promotions", label: "Deals & promotions", shortLabel: "Deals", icon: "promotions" },
        { to: "/buyer/orders", label: "My orders", shortLabel: "Orders", icon: "orders" },
        { to: "/cart", label: "Cart", shortLabel: "Cart", icon: "cart" },
        { to: "/account", label: "Account & safety", shortLabel: "Account", icon: "account" },
      ];

export const bottomNavigationItemsForRole = (role: UserRole) =>
  navigationItemsForRole(role).filter(
    (item) => !(role === UserRole.PRODUCER && item.to.includes("view=farm"))
  );

export const isNavigationTargetActive = (
  pathname: string,
  search: string,
  target: string
) => {
  const [targetPath, targetQuery = ""] = target.split("?");
  if (pathname !== targetPath) return false;
  if (!targetQuery) return true;
  return new URLSearchParams(search).get("view") === new URLSearchParams(targetQuery).get("view");
};
