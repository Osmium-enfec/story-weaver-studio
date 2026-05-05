import { CheckCircle2 } from "lucide-react";

export function PlaceholderPage({
  icon,
  title,
  description,
  bullets,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="mt-4 text-2xl font-bold">{title}</h2>
      <p className="mt-2 text-muted-foreground">{description}</p>
      <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
