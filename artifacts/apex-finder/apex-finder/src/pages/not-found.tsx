import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-background text-foreground p-4">
      <AlertCircle className="w-16 h-16 text-primary mb-6 opacity-80" />
      <h1 className="text-2xl font-bold font-mono tracking-widest uppercase mb-2">404 - Not Found</h1>
      <p className="text-muted-foreground text-sm font-mono mb-8 max-w-md text-center">
        The requested path does not exist in the intelligence registry.
      </p>
      <Link href="/" className="px-4 py-2 border border-primary text-primary font-mono text-sm uppercase tracking-wider hover:bg-primary/10 transition-colors">
        Return to HQ
      </Link>
    </div>
  );
}