import { Link } from "wouter";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <SiteLayout
      title="Page not found"
      description="This page may have moved, or the link may be incorrect."
    >
      <div className="site-support-panel text-center py-16">
        <Compass className="w-12 h-12 mx-auto mb-5 text-primary" />
        <p className="text-5xl font-black mb-3">404</p>
        <p className="text-muted-foreground mb-6">
          Let's get you back to the games.
        </p>
        <Link href="/" className="site-action site-action-primary">
          <ArrowLeft className="w-4 h-4" />
          Back to lobby
        </Link>
      </div>
    </SiteLayout>
  );
}
