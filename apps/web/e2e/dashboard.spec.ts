import { expect, test } from "@playwright/test";

test("landing page links into the dashboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("overview shows live data from the demo source", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /22_VOID live dashboard/i })).toBeVisible();
  await expect(page.getByTestId("data-source")).toHaveText("demo");
  await expect(page.getByTestId("provider-health")).toBeVisible();
  await expect(page.getByTestId("scanner-heartbeat")).toBeVisible();
  await expect(page.getByTestId("opportunity-table")).toBeVisible();
});

test("opportunity list filters by lifecycle status", async ({ page }) => {
  await page.goto("/opportunities");
  const table = page.getByTestId("opportunity-table");
  await expect(table).toBeVisible();

  await page.getByLabel("Status").selectOption("VERIFIED_ARB");
  await expect(page).toHaveURL(/status=VERIFIED_ARB/);
  await expect(page.getByTestId("opportunity-table").locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("[data-badge=VERIFIED_ARB]").first()).toBeVisible();
});

test("opportunity inspection flow exposes every explanation", async ({ page }) => {
  await page.goto("/opportunities/opp_verified_totals");

  await expect(page.getByRole("heading", { name: "Arsenal v Chelsea" })).toBeVisible();
  await expect(page.getByTestId("guarantee-cards")).toBeVisible();
  await expect(page.getByTestId("min-return")).toHaveText("KSh 105.00");
  await expect(page.getByTestId("guaranteed-profit")).toHaveText("KSh 5.00");

  await expect(page.getByTestId("leg-matrix")).toBeVisible();
  await expect(page.getByTestId("bookmaker-comparison")).toBeVisible();
  await expect(page.getByTestId("stake-calculator")).toBeVisible();

  await expect(page.getByTestId("evidence")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Positive guaranteed return/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Settlement coverage/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Freshness/i })).toBeVisible();

  const profit = await page.getByTestId("calc-profit").textContent();
  expect(profit).toMatch(/KSh 5\.00/);

  await expect(page.getByTestId("engine-versions")).toContainText("Engines");
});

test("a rejected opportunity explains why it was rejected", async ({ page }) => {
  await page.goto("/opportunities/opp_rejected_handicap");
  await expect(page.getByText("Why this is not an opportunity")).toBeVisible();
  await expect(page.getByText("No positive guaranteed return")).toBeVisible();
  await expect(page.getByText("Reason code: NEGATIVE_GUARANTEED_PROFIT")).toBeVisible();
});

test("event detail shows the market matrix", async ({ page }) => {
  await page.goto("/events/evt_ars_che");
  await expect(page.getByRole("heading", { name: "Arsenal v Chelsea" })).toBeVisible();
  await expect(page.getByTestId("market-matrix")).toBeVisible();
  await expect(page.getByText("Goals over/under")).toBeVisible();
  await expect(page.getByText("Match result")).toBeVisible();
  await expect(page.getByTestId("source-links")).toContainText("pinnacle");
});

test("providers page shows health and scanner runs", async ({ page }) => {
  await page.goto("/providers");
  await expect(page.getByTestId("provider-pinnacle")).toBeVisible();
  await expect(page.getByTestId("provider-odds-api")).toBeVisible();
  await expect(page.getByTestId("scanner-runs")).toBeVisible();
  await expect(page.getByText("full scan")).toBeVisible();
});
