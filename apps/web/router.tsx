import React, {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type RouteLocation = {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
};

type NavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

type NavigateFunction = (to: string, options?: NavigateOptions) => void;

type RouterContextValue = {
  location: RouteLocation;
  navigate: NavigateFunction;
};

const RouterContext = createContext<RouterContextValue | null>(null);

export const normalizeRouteTarget = (target: string) => {
  if (!target) return "/";
  return target.startsWith("/") ? target : `/${target}`;
};

export const parseHashLocation = (
  hash: string,
  state: unknown = null
): RouteLocation => {
  const route = hash.startsWith("#") ? hash.slice(1) : "/";
  const normalized = normalizeRouteTarget(route);
  const queryStart = normalized.indexOf("?");

  return {
    pathname: queryStart === -1 ? normalized : normalized.slice(0, queryStart),
    search: queryStart === -1 ? "" : normalized.slice(queryStart),
    hash,
    state,
  };
};

const readLocation = (): RouteLocation => {
  return parseHashLocation(
    window.location.hash,
    window.history.state?.maineFarmMarketRouteState ?? null
  );
};

export function HashRouter({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<RouteLocation>(() => readLocation());

  const syncLocation = useCallback(() => {
    setLocation(readLocation());
  }, []);

  useEffect(() => {
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, [syncLocation]);

  const navigate = useCallback<NavigateFunction>(
    (to: string, options: NavigateOptions = {}) => {
      const target = normalizeRouteTarget(to);
      const currentDepth = Number(
        window.history.state?.maineFarmMarketDepth ?? 0
      );
      const nextState = {
        ...(window.history.state ?? {}),
        maineFarmMarketRouteState: options.state ?? null,
        maineFarmMarketDepth: options.replace ? currentDepth : currentDepth + 1,
      };
      const nextUrl = `#${target}`;

      if (options.replace) {
        window.history.replaceState(nextState, "", nextUrl);
      } else {
        window.history.pushState(nextState, "", nextUrl);
      }
      syncLocation();
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [syncLocation]
  );

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

const useRouter = () => {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("Maine Farm Market router components must be inside HashRouter.");
  }
  return context;
};

export const useLocation = () => useRouter().location;

export const useNavigate = () => useRouter().navigate;

export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParams | string | Record<string, string>) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );

  const setParams = useCallback(
    (next: URLSearchParams | string | Record<string, string>) => {
      const query =
        next instanceof URLSearchParams
          ? next.toString()
          : typeof next === "string"
            ? next.replace(/^\?/, "")
            : new URLSearchParams(next).toString();
      navigate(`${location.pathname}${query ? `?${query}` : ""}`);
    },
    [location.pathname, navigate]
  );

  return [params, setParams];
}

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
};

export function Link({ to, onClick, target, ...props }: LinkProps) {
  const navigate = useNavigate();
  const href = `#${normalizeRouteTarget(to)}`;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return (
    <a {...props} href={href} target={target} onClick={handleClick} />
  );
}

type NavigateProps = NavigateOptions & {
  to: string;
};

export function Navigate({ to, replace, state }: NavigateProps) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, replace, state, to]);
  return null;
}

type RouteProps = {
  path: string;
  element: React.ReactNode;
};

export function Route(_props: RouteProps) {
  return null;
}

export function Routes({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  let fallback: React.ReactNode = null;

  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue;
    if (child.props.path === "*") {
      fallback = child.props.element;
    } else if (child.props.path === pathname) {
      return <>{child.props.element}</>;
    }
  }

  return <>{fallback}</>;
}
