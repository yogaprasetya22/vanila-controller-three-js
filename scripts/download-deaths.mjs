import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { parseFile } from "music-metadata";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "sounds");

// 5 different targets for short death sounds (max 3 seconds)
const TARGETS = [
    { name: "death_1.mp3", search: "grunt of pain male", max: 3 },
    { name: "death_2.mp3", search: "death groan male", max: 3 },
    { name: "death_3.mp3", search: "grunt pain female", max: 3 },
    { name: "death_4.mp3", search: "retro game death", max: 3 },
    { name: "death_5.mp3", search: "oof pain", max: 3 },
];

const CONCURRENCY_LIMIT = 5;

async function scrapeDetailUrls(page, search, workerName) {
    await page.goto(
        `https://pixabay.com/sound-effects/search/${encodeURIComponent(search)}/`,
        { waitUntil: "networkidle", timeout: 60000 },
    );
    await page.waitForTimeout(3000);

    const entries = await page.$$eval("body", ([body]) => {
        const html = body.innerHTML;
        const result = [];
        const regex =
            /(\d+):(\d{2})\s*[\s\S]*?href="(\/sound-effects\/[^"]*?\d[^"]*)"/g;
        let m;
        while ((m = regex.exec(html))) {
            const dur = parseInt(m[1]) * 60 + parseInt(m[2]);
            const href = "https://pixabay.com" + m[3];
            result.push({ dur, href });
        }
        return result;
    });

    console.log(
        `[${workerName}] Found ${entries.length} entries for "${search}"`,
    );
    return entries.sort((a, b) => a.dur - b.dur);
}

async function processTarget(browser, t, workerId) {
    const workerName = `W-${workerId}`;
    console.log(`[${workerName}] ⬇ Mulai: ${t.name}`);

    const ctx = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    });
    const page = await ctx.newPage();

    try {
        const candidates = await scrapeDetailUrls(page, t.search, workerName);
        const valid = candidates.filter((c) => c.dur <= t.max).slice(0, 5);

        if (valid.length === 0) {
            console.log(`[${workerName}] ✗ no match untuk ${t.name}`);
            return false;
        }

        // Try candidate entries one by one until one successfully downloads
        for (const entry of valid) {
            let mp3Buf = null;

            page.on("response", async (r) => {
                if (
                    !mp3Buf &&
                    (r.url().endsWith(".mp3") || r.url().includes(".mp3?")) &&
                    r.status() < 400
                ) {
                    try {
                        mp3Buf = Buffer.from(await r.body());
                    } catch {}
                }
            });

            console.log(
                `[${workerName}] → Coba ${entry.href.split("/").slice(-2, -1)[0]} (${entry.dur}s)`,
            );

            await page.goto(entry.href, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });
            await page.waitForTimeout(2000);

            await page.evaluate(() => {
                for (const el of document.querySelectorAll(
                    "button, [role='button'], div[class*='play'], svg[class*='play']",
                )) {
                    const s = (
                        (el.getAttribute("aria-label") || "") +
                        (el.className || "") +
                        (el.textContent || "")
                    ).toLowerCase();
                    if (s.includes("play")) {
                        el.click();
                        return;
                    }
                }
            });

            for (let i = 0; i < 20 && !mp3Buf; i++) {
                await page.waitForTimeout(500);
            }

            if (mp3Buf) {
                const outPath = join(OUT_DIR, t.name);
                writeFileSync(outPath, mp3Buf);
                const meta = await parseFile(outPath);
                console.log(
                    `[${workerName}] ✓ ${t.name} tersimpan | ${meta.format.duration.toFixed(1)}s | ${(mp3Buf.length / 1024).toFixed(1)} KB`,
                );
                return true;
            }
        }

        console.log(`[${workerName}] ✗ Gagal mendownload ${t.name}`);
        return false;
    } catch (e) {
        console.log(`[${workerName}] ✗ Error ${t.name}: ${e.message}`);
        return false;
    } finally {
        await ctx.close();
    }
}

async function main() {
    console.log("🎵 Pixabay Death Sounds Downloader\n");
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

    const browser = await chromium.launch({ headless: true });

    let ok = 0;
    let fail = 0;
    const queue = [...TARGETS];

    async function worker(workerId) {
        while (queue.length > 0) {
            const task = queue.shift();
            if (task) {
                const success = await processTarget(browser, task, workerId);
                if (success) ok++;
                else fail++;
            }
        }
    }

    const workers = [];
    const limit = Math.min(CONCURRENCY_LIMIT, TARGETS.length);
    for (let i = 1; i <= limit; i++) {
        workers.push(worker(i));
    }

    await Promise.all(workers);
    await browser.close();

    console.log(`\n✅ ${ok}/${TARGETS.length} Berhasil didownload`);
    if (fail) console.log(`❌ ${fail} Gagal`);
}

main();
