/**
 * Python Tool Subprocess Runner
 *
 * Wraps Python OSINT CLI tools (Holehe, Maigret, theHarvester, GLiNER)
 * as async TypeScript functions. Each tool is called via child_process.spawn
 * with a timeout, and output is parsed from JSON or stdout.
 *
 * Tools:
 *   - Holehe:       email → platform presence (120+ platforms)
 *   - Maigret:      username → cross-platform dossier (3,000+ sites)
 *   - theHarvester: domain → emails/subdomains/IPs from public sources
 *
 * GLiNER is handled separately via gliner-client.ts (HTTP microservice).
 *
 * Installation: run scripts/install-python-tools.sh (auto-run on startup)
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "./logger";

// ── Subprocess runner ─────────────────────────────────────────────────────────

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Replit installs Python packages into .pythonlibs alongside the workspace.
// Node's PATH inherits the module system's python3 which already has site-packages.
function buildPythonEnv(extra?: Record<string, string>): Record<string, string> {
  return {
    ...process.env,
    ...extra,
    PYTHONUNBUFFERED: "1",
  };
}

function runSubprocess(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
  env?: Record<string, string>
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      env: buildPythonEnv(env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ stdout, stderr: stderr + "\n[timeout]", exitCode: -1 });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: -2 });
    });
  });
}

// ── Tool availability check ───────────────────────────────────────────────────

const toolAvailability: Record<string, boolean | null> = {};

async function isToolAvailable(tool: string): Promise<boolean> {
  if (toolAvailability[tool] !== undefined) return toolAvailability[tool]!;
  const result = await runSubprocess("which", [tool], 5_000);
  const available = result.exitCode === 0 && result.stdout.trim().length > 0;
  toolAvailability[tool] = available;
  return available;
}

async function isPythonModuleAvailable(module: string): Promise<boolean> {
  const key = `module:${module}`;
  if (toolAvailability[key] !== undefined) return toolAvailability[key]!;
  const result = await runSubprocess("python3", ["-c", `import ${module}`], 5_000);
  const available = result.exitCode === 0;
  toolAvailability[key] = available;
  return available;
}

// ── Holehe: email → platform presence ────────────────────────────────────────

export interface HolehePlatform {
  name: string;
  url?: string;
  exists: boolean;
  emailrecovery?: boolean;
  phonenumber?: boolean;
  others?: Record<string, unknown>;
}

export interface HoleheResult {
  email: string;
  found: HolehePlatform[];
  totalChecked: number;
  totalFound: number;
  available: boolean;
  error?: string;
}

export async function runHolehe(email: string): Promise<HoleheResult> {
  const base: HoleheResult = {
    email,
    found: [],
    totalChecked: 0,
    totalFound: 0,
    available: false,
  };

  if (!email?.includes("@")) return { ...base, error: "Invalid email" };

  const available = await isPythonModuleAvailable("holehe");
  if (!available) {
    logger.debug("[Holehe] module not installed — run scripts/install-python-tools.sh");
    return { ...base, error: "holehe not installed" };
  }

  const tmpFile = path.join(os.tmpdir(), `holehe-${Date.now()}.json`);

  try {
    // holehe EMAIL --only-used --json > tmpFile
    const result = await runSubprocess(
      "python3",
      ["-m", "holehe", email, "--only-used", "--json", "--output", tmpFile],
      90_000
    );

    // Try reading JSON output file
    let platforms: HolehePlatform[] = [];
    try {
      const raw = await fs.readFile(tmpFile, "utf8");
      const data = JSON.parse(raw) as any[];
      platforms = data
        .filter((p: any) => p?.exists === true || p?.rateLimit === true)
        .map((p: any): HolehePlatform => ({
          name: p?.name ?? p?.website ?? "Unknown",
          url: p?.url ?? undefined,
          exists: p?.exists === true,
          emailrecovery: p?.emailrecovery ?? undefined,
          phonenumber: p?.phonenumber ?? undefined,
        }));
    } catch {
      // Parse stdout as fallback
      const lines = result.stdout.split("\n");
      for (const line of lines) {
        const match = line.match(/\[✓\]\s+(.+)/);
        if (match) {
          platforms.push({ name: match[1]!.trim(), exists: true });
        }
      }
    }

    logger.info({ email, found: platforms.length }, "[Holehe] platform check complete");

    return {
      email,
      found: platforms,
      totalChecked: 120, // approximate
      totalFound: platforms.length,
      available: true,
    };
  } catch (err: any) {
    logger.warn({ email, err: err.message }, "[Holehe] run failed");
    return { ...base, available: true, error: err.message };
  } finally {
    fs.unlink(tmpFile).catch(() => {});
  }
}

// ── Maigret: username → cross-platform dossier ───────────────────────────────

export interface MaigretProfile {
  siteName: string;
  url?: string;
  status: "found" | "not_found" | "error" | "unknown";
  profileData?: Record<string, string>;
  tags?: string[];
}

export interface MaigretResult {
  username: string;
  found: MaigretProfile[];
  totalSitesChecked: number;
  available: boolean;
  reportUrl?: string;
  error?: string;
}

export async function runMaigret(username: string): Promise<MaigretResult> {
  const base: MaigretResult = {
    username,
    found: [],
    totalSitesChecked: 0,
    available: false,
  };

  const sanitized = username.replace(/[^a-zA-Z0-9._\-]/g, "");
  if (!sanitized) return { ...base, error: "Invalid username" };

  const available = await isPythonModuleAvailable("maigret");
  if (!available) {
    logger.debug("[Maigret] module not installed — run scripts/install-python-tools.sh");
    return { ...base, error: "maigret not installed" };
  }

  const tmpDir = path.join(os.tmpdir(), `maigret-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const result = await runSubprocess(
      "python3",
      [
        "-m", "maigret",
        sanitized,
        "--json", "ndjson",
        "--folderoutput", tmpDir,
        "--top-sites", "500",
        "--timeout", "30",
        "--no-color",
      ],
      120_000
    );

    // Parse NDJSON output
    const jsonFile = path.join(tmpDir, `${sanitized}.json`);
    let profiles: MaigretProfile[] = [];

    try {
      const raw = await fs.readFile(jsonFile, "utf8");
      const data = JSON.parse(raw) as any;
      const sites: Record<string, any> = data?.sites ?? data ?? {};

      for (const [siteName, info] of Object.entries(sites)) {
        const status = info?.status?.status ?? info?.status ?? "unknown";
        if (status === "Claimed" || status === "found") {
          profiles.push({
            siteName,
            url: info?.url_user ?? info?.url ?? undefined,
            status: "found",
            profileData: info?.data ?? info?.profile_data ?? undefined,
            tags: info?.tags ?? undefined,
          });
        }
      }
    } catch {
      // Parse stdout fallback
      const lines = result.stdout.split("\n");
      for (const line of lines) {
        const m = line.match(/\[✓\]\s+(.+?):\s+(https?:\/\/[^\s]+)/);
        if (m) profiles.push({ siteName: m[1]!.trim(), url: m[2]!.trim(), status: "found" });
      }
    }

    logger.info({ username, found: profiles.length }, "[Maigret] dossier complete");

    return {
      username,
      found: profiles,
      totalSitesChecked: 500,
      available: true,
    };
  } catch (err: any) {
    logger.warn({ username, err: err.message }, "[Maigret] run failed");
    return { ...base, available: true, error: err.message };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── theHarvester: domain → emails/subdomains ─────────────────────────────────

export interface HarvesterResult {
  domain: string;
  emails: string[];
  subdomains: string[];
  ips: string[];
  hosts: string[];
  totalFound: number;
  available: boolean;
  error?: string;
}

export async function runTheHarvester(
  domain: string,
  sources = "bing,duckduckgo,yahoo,certspotter,crtsh"
): Promise<HarvesterResult> {
  const base: HarvesterResult = {
    domain,
    emails: [],
    subdomains: [],
    ips: [],
    hosts: [],
    totalFound: 0,
    available: false,
  };

  const cleanDomain = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!cleanDomain || !cleanDomain.includes(".")) return { ...base, error: "Invalid domain" };

  // Check if theHarvester is available
  const available = (await isToolAvailable("theHarvester")) || (await isPythonModuleAvailable("theHarvester"));
  if (!available) {
    logger.debug("[theHarvester] not installed — run scripts/install-python-tools.sh");
    return { ...base, error: "theHarvester not installed" };
  }

  const tmpFile = path.join(os.tmpdir(), `harvester-${Date.now()}.json`);

  try {
    const cmd = (await isToolAvailable("theHarvester")) ? "theHarvester" : "python3";
    const args = cmd === "theHarvester"
      ? ["-d", cleanDomain, "-b", sources, "-f", tmpFile.replace(".json", ""), "-l", "200"]
      : ["-m", "theHarvester", "-d", cleanDomain, "-b", sources, "-f", tmpFile.replace(".json", ""), "-l", "200"];

    await runSubprocess(cmd, args, 120_000);

    // Parse JSON output
    let emails: string[] = [];
    let subdomains: string[] = [];
    let ips: string[] = [];
    let hosts: string[] = [];

    try {
      const jsonPath = tmpFile.replace(".json", ".json");
      const raw = await fs.readFile(jsonPath, "utf8");
      const data = JSON.parse(raw) as any;
      emails = data?.emails ?? [];
      subdomains = data?.hosts ?? data?.subdomains ?? [];
      ips = data?.ips ?? [];
      hosts = data?.hosts ?? [];
    } catch {
      // Text output parsing
      const txtPath = tmpFile.replace(".json", ".txt");
      try {
        const text = await fs.readFile(txtPath, "utf8");
        const emailRe = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
        emails = [...new Set([...text.matchAll(emailRe)].map(m => m[0].toLowerCase()))];
        const hostRe = new RegExp(`\\b([a-z0-9][a-z0-9\\-]+\\.${cleanDomain.replace(".", "\\.")})\\b`, "gi");
        subdomains = [...new Set([...text.matchAll(hostRe)].map(m => m[0].toLowerCase()))];
      } catch { /* both outputs missing */ }
    }

    const totalFound = emails.length + subdomains.length + ips.length;
    logger.info({ domain: cleanDomain, emails: emails.length, subdomains: subdomains.length }, "[theHarvester] scan complete");

    return { domain: cleanDomain, emails, subdomains, ips, hosts, totalFound, available: true };
  } catch (err: any) {
    logger.warn({ domain: cleanDomain, err: err.message }, "[theHarvester] run failed");
    return { ...base, available: true, error: err.message };
  } finally {
    for (const ext of [".json", ".txt", ".xml"]) {
      fs.unlink(tmpFile.replace(".json", ext)).catch(() => {});
    }
  }
}

// ── Availability check endpoint ───────────────────────────────────────────────

export async function checkPythonToolsAvailability(): Promise<Record<string, boolean>> {
  const checks = await Promise.all([
    isPythonModuleAvailable("holehe"),
    isPythonModuleAvailable("maigret"),
    isToolAvailable("theHarvester").then(async v => v || isPythonModuleAvailable("theHarvester")),
  ]);

  return {
    holehe: checks[0]!,
    maigret: checks[1]!,
    theHarvester: checks[2]!,
  };
}
