import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function seedEmulators() {
  if (process.platform === "win32") {
    execFileSync(
      process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "npm.cmd --prefix ../../services/functions run seed:emulator"],
      { cwd: process.cwd(), env: process.env, stdio: "inherit" }
    );
    return;
  }
  execFileSync(
    "npm",
    ["--prefix", "../../services/functions", "run", "seed:emulator"],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" }
  );
}

test.describe.serial("Maine Farm Market buyer and producer journeys", () => {
  test.beforeEach(async () => {
    seedEmulators();
  });

  test("buyer can see producer contact, cancel a direct order, and open a dispute", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: /Shop the Market/ }).click();
    await expect(page.getByRole("heading", { name: "Fresh from Maine" })).toBeVisible();
    await page.getByRole("button", { name: "My Orders" }).click();
    await expect(page.getByRole("heading", { name: "Your Orders" })).toBeVisible();
    await expect(page.getByRole("link", { name: "207-555-0100" }).first()).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel order" }).first().click();
    await expect(page.getByRole("status")).toContainText("reserved inventory released");
    await expect(page.locator("body")).toContainText("Status: cancelled");

    await page.getByRole("button", { name: /Report a problem|Add dispute details/ }).first().click();
    await page.getByPlaceholder(/Describe the problem/).fill(
      "The pickup details need support review in this automated test."
    );
    await page.getByRole("button", { name: "Submit problem" }).click();
    await expect(page.getByRole("status")).toContainText("sent to Maine Farm Market support");
  });

  test("producer can review and accept an incoming direct-payment order", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: /Start Selling/ }).click();
    await expect(page.getByRole("heading", { name: "Farm Manager" })).toBeVisible();
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    await expect(page.getByText(/Arrange payment directly with the buyer/)).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).first().click();
    await expect(page.getByText(/Order .* ACCEPTED/)).toBeVisible();
  });

  test("buyer can place a server-priced direct order from the marketplace", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: /Shop the Market/ }).click();
    await expect(page.getByText(/Maine Blueberries/).first()).toBeVisible();
    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await page.getByRole("button", { name: /View Cart/ }).click();

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateValue = tomorrow.toISOString().slice(0, 10);
    await page.getByLabel(/Pickup date/).fill(dateValue);
    await page.getByLabel(/Pickup time/).fill("12:00");
    await page.getByRole("button", { name: "Place Order" }).click();

    await expect(page.getByRole("heading", { name: "Your Orders" })).toBeVisible();
    await expect(page.getByText(/Payment is arranged directly/).first()).toBeVisible();
    await expect(page.getByText(/Producer acceptance deadline/).first()).toBeVisible();
  });
});
