import { expect, test } from "@playwright/test";

test("saves a normalized title without a browser exception", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByLabel("Title").fill("  Draft   note  ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft note");
  expect(errors, "browser runtime errors").toEqual([]);
});
