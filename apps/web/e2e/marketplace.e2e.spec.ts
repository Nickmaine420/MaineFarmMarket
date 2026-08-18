import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function seedEmulators(options: { buyerIncomplete?: boolean } = {}) {
  execFileSync(
    process.execPath,
    [
      "../../services/functions/scripts/seed-emulator.js",
      ...(options.buyerIncomplete ? ["--buyer-incomplete"] : []),
    ],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" }
  );
}

test.describe.serial("Maine Farm Market buyer and producer journeys", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => console.error(`[browser page error] ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[browser console error] ${message.text()}`);
    });
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
    await page.getByRole("button", { name: /^Orders(?: \(\d+\))?$/ }).click();
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
    await expect(page.getByRole("heading", { name: "Partner pickup locations" })).toBeVisible();
    await page.getByLabel("Test Pine Farm").selectOption("emulator-partner-producer");

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateValue = tomorrow.toISOString().slice(0, 10);
    await page.getByLabel(/Pickup date/).fill(dateValue);
    await page.getByLabel(/Pickup time/).fill("12:00");
    await page.getByRole("button", { name: "Place Order" }).click();

    await expect(page.getByRole("heading", { name: "Your Orders" })).toBeVisible();
    await expect(page.getByText(/Payment is arranged directly/).first()).toBeVisible();
    await expect(page.getByText(/Producer acceptance deadline/).first()).toBeVisible();
    await expect(page.getByText(/Partner pickup:.*Test River Farm/).first()).toBeVisible();
  });

  test("buyer can discover discounts, public producer profiles, events, and recommendations", async ({ page }, testInfo) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: /Shop the Market/ }).click();
    await expect(page.getByText("TEST HARVEST DEAL")).toBeVisible();
    await page.getByRole("link", { name: "Test Pine Farm", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Test Pine Farm", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Producers we recommend" })).toBeVisible();
    await expect(page.getByText("Test River Farm").first()).toBeVisible();
    await page.getByRole("link", { name: "Events", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Maine market events" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Harvest Market/ })).toBeVisible();
    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("navigation", { name: "App navigation" }).getByRole("link", { name: "Deals", exact: true }).click();
    } else {
      await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Deals & promotions", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Deals, events, and seasonal finds" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Weekend farm box/ })).toBeVisible();
  });

  test("producer can publish a promotion and an event from growth tools", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: /Start Selling/ }).click();
    await expect(page.getByRole("heading", { name: "Farm Manager" })).toBeVisible();
    await page.goto("/#/producer/growth");
    await expect(page.getByRole("heading", { name: "Promote, gather, and partner" })).toBeVisible();

    await page.getByLabel("Promotion headline").fill("Fresh harvest updates");
    await page.getByRole("button", { name: "Save promotion page" }).click();
    await expect(page.getByRole("status")).toContainText("promotion page is live");

    await page.getByLabel("Title", { exact: true }).fill("Midweek harvest box");
    await page.getByLabel("Details").fill("A producer-selected box of peak-season goods.");
    await page.getByRole("button", { name: "Publish deal" }).click();
    await expect(page.getByRole("status")).toContainText("custom promotion is scheduled");
    await expect(page.getByRole("heading", { name: "Midweek harvest box" })).toBeVisible();

    await page.getByRole("button", { name: "Events", exact: true }).first().click();
    await page.getByLabel("Event name").fill("Community farm evening");
    await page.getByLabel("Description").fill("Meet local producers and browse seasonal goods.");
    await page.getByLabel("Venue").fill("Test Pine Farm");
    await page.getByLabel("Public address").fill("10 Farm Road");
    await page.getByLabel("Goods/categories").fill("Produce, Honey");
    await page.getByRole("button", { name: "Publish event" }).click();
    await expect(page.getByRole("status")).toContainText("event is published");
    await expect(page.getByRole("heading", { name: "Community farm evening" })).toBeVisible();

    await page.getByRole("button", { name: "Network", exact: true }).click();
    await expect(page.getByText("A trusted emulator test neighbor.")).toBeVisible();
    await expect(page.getByText("accepted", { exact: true })).toBeVisible();
  });

  test("producer can add, archive, and restore a public profile photo", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: /Start Selling/ }).click();
    await expect(page.getByRole("heading", { name: "Farm Manager" })).toBeVisible();
    await page.goto("/#/producer?view=farm");
    await expect(page.getByRole("heading", { name: "Farm Profile" })).toBeVisible();

    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7bcAAAAASUVORK5CYII=",
      "base64"
    );
    await page.getByLabel("Photo", { exact: true }).setInputFiles({
      name: "test-farm.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await page.getByLabel("Photo description").fill("Test farm stand");
    await page.getByRole("button", { name: "Add photo" }).click();
    await expect(page.getByRole("status")).toContainText("Profile photo uploaded");
    await expect(page.getByRole("img", { name: "Test farm stand" })).toBeVisible();

    await page.getByRole("button", { name: "Hide and archive" }).click();
    await expect(page.getByRole("status")).toContainText("preserved in the archive");
    await page.getByText("Archived photos (1)").click();
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status")).toContainText("Photo restored");
    await expect(page.getByRole("img", { name: "Test farm stand" })).toBeVisible();
  });

  test("first-time buyer completes setup without a loading or redirect loop", async ({ page }) => {
    seedEmulators({ buyerIncomplete: true });
    await page.goto("/#/");
    await page.getByRole("button", { name: /Shop the Market/ }).click();

    await expect(
      page.getByRole("heading", { name: "Welcome to Maine Farm Market" })
    ).toBeVisible();
    await page.getByLabel("Mailing address").fill("12 Test Farm Road");
    await page.getByLabel("City or town").fill("Waterville");
    await page.getByLabel("ZIP code").fill("04901");
    await page.getByRole("button", { name: "Save and start shopping" }).click();

    await expect(page.getByRole("heading", { name: "Fresh from Maine" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Loading your buyer setup…")).toHaveCount(0);
  });

  test("mobile navigation is compact, complete, and does not duplicate sign out", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile navigation check");
    await page.goto("/#/");
    await page.getByRole("button", { name: /Shop the Market/ }).click();
    await expect(page.getByRole("heading", { name: "Fresh from Maine" })).toBeVisible();

    const appNavigation = page.getByRole("navigation", { name: "App navigation" });
    await expect(appNavigation.getByRole("link", { name: "Market", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(appNavigation.getByRole("link", { name: "Orders", exact: true })).toBeVisible();
    await expect(appNavigation.getByRole("link", { name: "Events", exact: true })).toBeVisible();
    await expect(appNavigation.getByRole("link", { name: "Deals", exact: true })).toBeVisible();
    await expect(appNavigation.getByRole("link", { name: "Cart", exact: true })).toBeVisible();
    await expect(appNavigation.getByRole("link", { name: "Account", exact: true })).toBeVisible();

    await appNavigation.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your Orders" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Cart", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Cart" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account and safety" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Market", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fresh from Maine" })).toBeVisible();

    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.getByRole("link", { name: "Contact & support" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Marketplace" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Account & safety" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("producer dashboard actions and navigation fit a mobile viewport", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Mobile producer layout check");
    await page.goto("/#/");
    await page.getByRole("button", { name: /Start Selling/ }).click();
    await expect(page.getByRole("heading", { name: "Farm Manager" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New Listing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage Subscription" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Products", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Orders(?: \(\d+\))?$/ })).toBeVisible();

    const appNavigation = page.getByRole("navigation", { name: "App navigation" });
    await appNavigation.getByRole("link", { name: "Products", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your Products" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Incoming Orders" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Events", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Maine market events" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Grow", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Promote, gather, and partner" })).toBeVisible();
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await menu.click();
    await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Farm profile" }).click();
    await expect(page.getByRole("heading", { name: "Farm Profile" })).toBeVisible();
    await appNavigation.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
