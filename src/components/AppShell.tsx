import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Film } from "lucide-react";

export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Film className="h-4 w-4" />
            </span>
            <span>Code Motion</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/" label="Dashboard" />
            <NavLink to="/assets" label="Assets" />
            <NavLink to="/settings" label="Settings" />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      className={`rounded-md px-3 py-1.5 transition-colors ${
        active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
