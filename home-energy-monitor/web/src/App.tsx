import { useEffect, useState } from "react";
import { hrefFor, navigate, useRoute, type Route } from "./lib/router.ts";
import { useLive } from "./lib/useLive.ts";
import { Overview } from "./pages/Overview.tsx";
import { ApplianceDetailPage } from "./pages/ApplianceDetail.tsx";
import { CategoryDetailPage } from "./pages/CategoryDetail.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Setup } from "./pages/Setup.tsx";

const NAV: { route: Route; label: string }[] = [
  { route: { name: "overview" }, label: "Overview" },
  { route: { name: "settings" }, label: "Settings" },
];

function title(
  route: Route,
  applianceName?: string,
  categoryName?: string,
): { crumb?: string; heading: string } {
  switch (route.name) {
    case "appliance":
      return { crumb: "Appliance", heading: applianceName ?? "Appliance" };
    case "category":
      return { crumb: "Category", heading: categoryName ?? "Category" };
    case "settings":
      return { heading: "Settings" };
    case "setup":
      return { heading: "Set up" };
    default:
      return { heading: "Home energy" };
  }
}

export function App() {
  const route = useRoute();
  const { snapshot, streaming } = useLive();

  const applianceName =
    route.name === "appliance"
      ? snapshot?.appliances.find((item) => item.id === route.id)?.name
      : undefined;
  // The category's name is only known once its page has loaded it; letting
  // the page report it avoids fetching the same thing twice.
  const [categoryName, setCategoryName] = useState<string | undefined>(undefined);
  const routeKey = route.name === "category" ? route.id : route.name;
  useEffect(() => setCategoryName(undefined), [routeKey]);

  const { crumb, heading } = title(route, applianceName, categoryName);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          {crumb ? <span className="crumb">{crumb}</span> : null}
          <h1>{heading}</h1>
        </div>
        <nav className="nav">
          {route.name === "appliance" || route.name === "category" ? (
            <a
              href={hrefFor({ name: "overview" })}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                navigate({ name: "overview" });
              }}
            >
              ← Back
            </a>
          ) : (
            NAV.map((item) => (
              <a
                key={item.label}
                href={hrefFor(item.route)}
                aria-current={item.route.name === route.name ? "page" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) return;
                  event.preventDefault();
                  navigate(item.route);
                }}
              >
                {item.label}
              </a>
            ))
          )}
        </nav>
      </header>

      <main>
        {route.name === "overview" ? <Overview live={snapshot} streaming={streaming} /> : null}
        {route.name === "appliance" ? (
          <ApplianceDetailPage id={route.id} live={snapshot} streaming={streaming} />
        ) : null}
        {route.name === "category" ? (
          <CategoryDetailPage
            id={route.id}
            live={snapshot}
            streaming={streaming}
            onTitle={setCategoryName}
          />
        ) : null}
        {route.name === "settings" ? <Settings /> : null}
        {route.name === "setup" ? <Setup /> : null}
      </main>
    </div>
  );
}
