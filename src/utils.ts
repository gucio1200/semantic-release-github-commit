import { RepoInfo, SemanticReleaseContext } from "./types";
import { createError } from "./errors";

/**
 * Get GitHub authentication token from environment or config
 */
export function getAuthToken(
  env: Record<string, string | undefined>,
  githubToken?: string,
): string {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || githubToken;

  if (!token) {
    throw createError(
      "EGHNOAUTH",
      "No GitHub authentication token found. Please provide GH_TOKEN, GITHUB_TOKEN environment variable, or githubToken in plugin config.",
    );
  }

  return token;
}

/**
 * Parse repository URL to extract owner and repo
 */
export function parseRepositoryUrl(url: string): {
  owner: string;
  repo: string;
  host: string;
} {
  // Handle various GitHub URL formats:
  // - https://github.com/owner/repo.git
  // - https://x-access-token:token@github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  // - https://github.com/owner/repo
  // - owner/repo

  let sanitizedUrl = url.replace(/\.git$/, "");
  let host = "";
  let owner = "";
  let repo = "";

  try {
    // Try parsing as a standard URL first (handles https://, ssh://, etc.)
    const parsedUrl = new URL(sanitizedUrl);
    host = parsedUrl.hostname;
    
    // Path usually starts with /, so split by / and get parts
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      owner = pathParts[pathParts.length - 2];
      repo = pathParts[pathParts.length - 1];
    }
  } catch (e) {
    // If URL parsing fails, it might be an SCP-like syntax (git@github.com:owner/repo.git)
    // or a simple "owner/repo" string
    
    // Check for SCP-like syntax (host:owner/repo)
    const scpMatch = sanitizedUrl.match(/^([a-zA-Z0-9@._-]+):([^/]+)\/([^/?#]+)$/);
    if (scpMatch) {
      // Extract host from "git@host" or just "host"
      const hostPart = scpMatch[1];
      host = hostPart.includes("@") ? hostPart.split("@")[1] : hostPart;
      owner = scpMatch[2];
      repo = scpMatch[3];
    } else {
      // Check for simple owner/repo
      const simpleMatch = sanitizedUrl.match(/^([^/]+)\/([^/]+)$/);
      if (simpleMatch) {
        host = "github.com";
        owner = simpleMatch[1];
        repo = simpleMatch[2];
      }
    }
  }

  if (!host || !owner || !repo) {
    throw createError("ENOREPO", `Unable to parse repository URL: ${url}`);
  }

  return { owner, repo, host };
}

/**
 * Get repository information from semantic-release context
 */
export function getRepoInfo(context: SemanticReleaseContext): RepoInfo {
  const { env, options } = context;

  // Get repository URL from options
  const repositoryUrl = (options as any).repositoryUrl;
  if (!repositoryUrl) {
    throw createError(
      "ENOREPO",
      "No repository URL found in semantic-release config",
    );
  }

  const { owner, repo, host } = parseRepositoryUrl(repositoryUrl);

  // Detect branch from environment or branch config
  let branch =
    env.GITHUB_REF?.replace("refs/heads/", "") ||
    env.GIT_BRANCH?.replace("origin/", "") ||
    env.BRANCH_NAME;

  // Fallback to branch from options
  if (!branch) {
    const branches = (options as any).branches;
    if (Array.isArray(branches) && branches.length > 0) {
      branch = typeof branches[0] === "string" ? branches[0] : branches[0].name;
    }
  }

  if (!branch) {
    throw createError(
      "ENOBRANCH",
      "Unable to detect branch name from CI environment or semantic-release config",
    );
  }

  return { owner, repo, branch, host };
}

/**
 * Get git author/committer info from environment or config
 * Note: Ignores semantic-release default bot identity to enable GitHub App auto-signing
 */
export function getGitIdentity(
  env: Record<string, string | undefined>,
  type: "author" | "committer",
  configName?: string,
  configEmail?: string,
): { name: string; email: string } | undefined {
  const name = configName || env[`GIT_${type.toUpperCase()}_NAME`];
  const email = configEmail || env[`GIT_${type.toUpperCase()}_EMAIL`];

  // Ignore semantic-release default bot identity to enable GitHub App auto-signing
  // This allows commits to be verified with the GitHub App's identity
  if (
    name === "semantic-release-bot" &&
    email === "semantic-release-bot@martynus.net"
  ) {
    return undefined;
  }

  if (name && email) {
    return { name, email };
  }

  return undefined;
}
