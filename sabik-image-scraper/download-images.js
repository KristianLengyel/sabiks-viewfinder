const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PAGES = [
  "https://sabik-ea453.web.app/",
  "https://sabik-ea453.web.app/portfolio",
  "https://sabik-ea453.web.app/about",
  "https://sabik-ea453.web.app/contact",
];

const OUTPUT_DIR = path.join(__dirname, "downloaded_images");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 160);
}

function getExtensionFromUrl(url, contentType = "") {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);

    if (ext && ext.length <= 6) {
      return ext;
    }
  } catch {}

  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("svg")) return ".svg";
  if (contentType.includes("avif")) return ".avif";

  return ".jpg";
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 500;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1920,
      height: 1080,
    },
  });

  const page = await context.newPage();

  const imageMap = new Map();

  page.on("response", async response => {
    const url = response.url();
    const headers = response.headers();
    const contentType = headers["content-type"] || "";

    if (contentType.startsWith("image/")) {
      imageMap.set(url, contentType);
    }
  });

  for (const url of PAGES) {
    console.log(`Opening: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForTimeout(3000);
      await autoScroll(page);
      await page.waitForTimeout(2000);

      const domImages = await page.evaluate(() => {
        const urls = new Set();

        document.querySelectorAll("img").forEach(img => {
          if (img.src) urls.add(img.src);

          const attributes = [
            "src",
            "data-src",
            "data-original",
            "data-lazy",
            "data-image",
            "srcset",
            "data-srcset",
          ];

          attributes.forEach(attr => {
            const value = img.getAttribute(attr);
            if (!value) return;

            if (attr.includes("srcset")) {
              value.split(",").forEach(part => {
                const src = part.trim().split(" ")[0];
                if (src) urls.add(src);
              });
            } else {
              urls.add(value);
            }
          });
        });

        document.querySelectorAll("source").forEach(source => {
          const srcset = source.getAttribute("srcset");
          if (!srcset) return;

          srcset.split(",").forEach(part => {
            const src = part.trim().split(" ")[0];
            if (src) urls.add(src);
          });
        });

        document.querySelectorAll("*").forEach(el => {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundImage;

          if (!bg || bg === "none") return;

          const matches = bg.match(/url\(["']?(.*?)["']?\)/g);

          if (matches) {
            matches.forEach(match => {
              const src = match
                .replace(/^url\(["']?/, "")
                .replace(/["']?\)$/, "");

              if (src) urls.add(src);
            });
          }
        });

        return Array.from(urls).map(src => new URL(src, window.location.href).href);
      });

      domImages.forEach(imgUrl => {
        if (!imageMap.has(imgUrl)) {
          imageMap.set(imgUrl, "");
        }
      });
    } catch (error) {
      console.error(`Failed to open ${url}`);
      console.error(error.message);
    }
  }

  const images = Array.from(imageMap.entries()).filter(([url]) => {
    return (
      /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(url) ||
      url.includes("firebasestorage.googleapis.com") ||
      url.includes("googleusercontent.com")
    );
  });

  console.log(`Found ${images.length} image(s).`);

  for (let i = 0; i < images.length; i++) {
    const [url, contentType] = images[i];

    try {
      const response = await context.request.get(url);

      if (!response.ok()) {
        console.error(`Failed ${response.status()}: ${url}`);
        continue;
      }

      const buffer = await response.body();
      const ext = getExtensionFromUrl(url, contentType);
      const filename = sanitizeFilename(`image_${String(i + 1).padStart(3, "0")}${ext}`);
      const filePath = path.join(OUTPUT_DIR, filename);

      fs.writeFileSync(filePath, buffer);

      console.log(`Saved: ${filename}`);
    } catch (error) {
      console.error(`Could not download: ${url}`);
      console.error(error.message);
    }
  }

  await browser.close();

  console.log(`Done. Images saved to: ${OUTPUT_DIR}`);
})();