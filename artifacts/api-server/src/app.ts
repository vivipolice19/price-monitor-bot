import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (existsSync(publicDir)) {
  app.get("/sheet-open", (req, res) => {
    const row = typeof req.query.row === "string" ? req.query.row : "";
    const url = typeof req.query.url === "string" ? req.query.url : "";
    const myPrice = typeof req.query.myPrice === "string" ? req.query.myPrice : "";
    const escaped = {
      row: JSON.stringify(row),
      url: JSON.stringify(url),
      myPrice: JSON.stringify(myPrice),
    };
    res.type("html").send(`<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>リサーチを開いています…</title></head>
<body>
  <script>
    (function () {
      var qs = new URLSearchParams();
      var row = ${escaped.row};
      var url = ${escaped.url};
      var myPrice = ${escaped.myPrice};
      if (row) qs.set("row", row);
      if (url) qs.set("url", url);
      if (myPrice) qs.set("myPrice", myPrice);
      var targetUrl = window.location.origin + "/?" + qs.toString();
      var targetName = "ebay-monitor-research";
      var w = window.open(targetUrl, targetName);
      if (w) {
        try { w.focus(); } catch (e) {}
        if (window.name === targetName) {
          window.location.replace(targetUrl);
        } else {
          window.close();
        }
      } else {
        window.location.replace(targetUrl);
      }
    })();
  </script>
  <p>リサーチ画面を開いています…</p>
</body>
</html>`);
  });

  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const indexHtml = path.join(publicDir, "index.html");
    if (!existsSync(indexHtml)) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
}

export default app;
