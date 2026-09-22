export function SiteFooter({ source }: { source: string }) {
  return (
    <footer className="border-t py-6 text-center text-xs text-muted-foreground">
      <p>
        22_VOID — football-first arbitrage detection. Data source:{" "}
        <span className="font-medium" data-testid="data-source">
          {source}
        </span>
        .
      </p>
      <p className="mt-1">
        Nothing is shown unless the outcome-state model proves a positive minimum return.
      </p>
    </footer>
  );
}
