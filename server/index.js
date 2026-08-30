const http = require("http");
const url = require("url");
const fs = require("fs").promises;
const path = require("path");

const PORT = process.env.PORT || 3001;
const STORAGE_DIR = path.resolve(__dirname, "../data");
const TRIPS_FILE_PATH = path.join(STORAGE_DIR, "trips.json");

function resolveRuntimeEnvValue(envName, fallbackPaths) {
  if (process.env[envName]) {
    return process.env[envName];
  }

  for (const candidatePath of fallbackPaths) {
    try {
      const raw = require("fs").readFileSync(candidatePath, "utf8");
      const match = raw.match(new RegExp(`^${envName}=(.*)$`, "m"));
      if (match && match[1]) {
        return match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Ignore missing files and keep checking.
    }
  }

  return "";
}

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1/chat/completions";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1";

async function ensureStorageDirectory() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

async function readTripsFromFile() {
  try {
    const content = await fs.readFile(TRIPS_FILE_PATH, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeTripsToFile(trips) {
  await ensureStorageDirectory();
  await fs.writeFile(TRIPS_FILE_PATH, JSON.stringify(trips, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      if (!body) {
        return resolve({});
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (pathname === "/api/route-poi" && req.method === "POST") {
    try {
      const { prompt } = await parseRequestBody(req);
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return sendError(res, 400, "Prompt is required.");
      }

      const response = await fetch(OLLAMA_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Te magyarul írsz, és mindig egyetlen, jól olvasható, hosszabb útvonal-összefoglaló szöveget adsz vissza. Semmilyen markdown, lista, számozás, vagy rövid tagmondat nem megengedett. Kiemeld a látnivalókat, érdekességeket és programlogikát.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.8,
          max_tokens: 200,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("[Server] Ollama error:", {
          status: response.status,
          payload,
        });
        return sendError(
          res,
          response.status || 500,
          payload?.error?.message || "Ollama request failed.",
        );
      }

      const answer = payload?.choices?.[0]?.message?.content?.trim() || "";

      if (!answer) {
        console.error("[Server] Ollama returned empty content.", payload);
        return sendError(res, 502, "Ollama returned an empty response.");
      }

      return sendJson(res, 200, { answer });
    } catch (error) {
      console.error("[Server] route-poi handler failed:", error);
      return sendError(res, 500, "Unable to generate the POI hint.");
    }
  }

  if (pathname === "/api/trips") {
    if (req.method === "GET") {
      try {
        const trips = await readTripsFromFile();
        return sendJson(res, 200, trips);
      } catch (error) {
        return sendError(res, 500, "Unable to read trips from storage.");
      }
    }

    if (req.method === "PUT") {
      try {
        const { trips } = await parseRequestBody(req);
        if (!Array.isArray(trips)) {
          return sendError(
            res,
            400,
            "Request body must include a trips array.",
          );
        }
        await writeTripsToFile(trips);
        return sendJson(res, 200, { success: true });
      } catch (error) {
        return sendError(res, 400, "Unable to parse request body.");
      }
    }
  }

  const tripIdMatch = pathname.match(/^\/api\/trips\/(.+)$/);
  if (tripIdMatch && req.method === "DELETE") {
    const tripId = decodeURIComponent(tripIdMatch[1]);
    try {
      const trips = await readTripsFromFile();
      const updatedTrips = trips.filter((trip) => trip.id !== tripId);
      await writeTripsToFile(updatedTrips);
      return sendJson(res, 200, { success: true });
    } catch (error) {
      return sendError(res, 500, "Unable to remove the trip.");
    }
  }

  sendError(res, 404, "Route not found.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
