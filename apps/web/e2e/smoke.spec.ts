import { expect, test } from "@playwright/test";

test("loads the 22_VOID landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /22_VOID/i })).toBeVisible();
  await expect(page.getByText("Detection pipeline")).toBeVisible();
});