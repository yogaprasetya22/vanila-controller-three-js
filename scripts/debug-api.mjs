cimport { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 Chrome/126" });
const page = await ctx.newPage();
await page.goto("https://pixabay.com/sound-effects/search/sword%20slash/", {
    waitUntil: "networkidle",
    timeout: 60000,
});
await page.waitForTimeout(5000);

// Dump semua anchor href
const allLinks = await page.$$eval("a[href*='sound-effects']", (links) =>
    links.map((a) => a.href).slice(0, 10),
);
console.log("All sound-effects links:", allLinks);

// Dump body text
const txt = await page.$eval("body", (b) => b.innerText.substring(0, 500));
console.log("Body:", txt);

await ctx.close();
await browser.close();
