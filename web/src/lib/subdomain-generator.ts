/**
 * Subdomain Generator
 *
 * Generates memorable subdomains in the format: {adjective}-{noun}-{000-999}
 * Examples: swift-cloud-742, bright-falcon-318, calm-river-509
 *
 * IMPORTANT: These word lists MUST match the backend exactly (alphabetically sorted)!
 * The backend uses Postgres generate_subdomain() function with the same word lists.
 */

// 100 adjectives (sorted alphabetically - MUST match backend!)
const ADJECTIVES = [
  "agile",
  "amber",
  "azure",
  "bold",
  "bright",
  "calm",
  "clear",
  "cool",
  "coral",
  "crisp",
  "cyan",
  "dark",
  "deep",
  "eager",
  "early",
  "easy",
  "elite",
  "epic",
  "even",
  "exact",
  "extra",
  "fair",
  "fancy",
  "fast",
  "fine",
  "firm",
  "first",
  "focal",
  "free",
  "fresh",
  "gold",
  "good",
  "grand",
  "great",
  "green",
  "happy",
  "ideal",
  "inner",
  "keen",
  "kind",
  "laser",
  "light",
  "live",
  "long",
  "loud",
  "lucky",
  "lunar",
  "major",
  "mega",
  "neat",
  "new",
  "noble",
  "odd",
  "open",
  "plain",
  "prime",
  "proud",
  "pure",
  "quick",
  "quiet",
  "rapid",
  "rare",
  "rich",
  "royal",
  "safe",
  "sharp",
  "shiny",
  "silent",
  "silver",
  "simple",
  "sleek",
  "slim",
  "smart",
  "smooth",
  "soft",
  "solid",
  "stable",
  "stark",
  "steady",
  "still",
  "strong",
  "sunny",
  "super",
  "sweet",
  "swift",
  "tall",
  "tidy",
  "tiny",
  "tough",
  "true",
  "vast",
  "vivid",
  "warm",
  "white",
  "wide",
  "wild",
  "wise",
  "young",
  "zesty",
];

// 100 nouns (sorted alphabetically - MUST match backend!)
const NOUNS = [
  "apex",
  "arc",
  "aspen",
  "atlas",
  "beam",
  "bear",
  "birch",
  "bolt",
  "bond",
  "bridge",
  "brook",
  "canyon",
  "cedar",
  "cliff",
  "cloud",
  "comet",
  "core",
  "cosmos",
  "cove",
  "crane",
  "crystal",
  "dragon",
  "eagle",
  "falcon",
  "field",
  "flame",
  "flow",
  "forest",
  "fox",
  "frost",
  "garden",
  "gate",
  "glass",
  "glen",
  "grove",
  "harbor",
  "haven",
  "hawk",
  "heron",
  "hub",
  "iris",
  "iron",
  "jade",
  "lake",
  "link",
  "lion",
  "lotus",
  "maple",
  "meadow",
  "mesa",
  "mint",
  "moon",
  "nebula",
  "nexus",
  "node",
  "nova",
  "oak",
  "onyx",
  "opal",
  "orbit",
  "owl",
  "path",
  "peak",
  "phoenix",
  "pine",
  "port",
  "prism",
  "pulse",
  "quasar",
  "rain",
  "raven",
  "reef",
  "ridge",
  "river",
  "road",
  "sage",
  "snow",
  "spark",
  "sphinx",
  "spire",
  "spring",
  "star",
  "steel",
  "stone",
  "storm",
  "stream",
  "summit",
  "sun",
  "surge",
  "tiger",
  "titan",
  "tower",
  "trail",
  "vale",
  "wave",
  "willow",
  "wind",
  "wolf",
];

/**
 * Simple hash function that produces consistent results matching Postgres md5()
 *
 * Note: This doesn't produce an actual MD5 hash, but generates consistent
 * byte values that will produce the same subdomain for the same org_id.
 * For exact matching with the backend, we rely on the auto_subdomain field
 * returned from the API. This is a fallback only.
 */
function hashOrgId(orgId: string): number[] {
  // Remove hyphens from UUID
  const clean = orgId.replace(/-/g, "").toLowerCase();

  // Simple hash function that produces 6 bytes of output
  // This is a simplified version - the backend generates the canonical subdomain
  const bytes: number[] = [];
  for (let i = 0; i < 6; i++) {
    let hash = 0;
    for (let j = 0; j < clean.length; j++) {
      const char = clean.charCodeAt(j);
      hash = ((hash << 5) - hash + char + i * 17) & 0xffffffff;
    }
    bytes.push(Math.abs(hash) & 0xff);
  }
  return bytes;
}

/**
 * Generate a subdomain from an organization ID
 *
 * Format: {adjective}-{noun}-{000-999}
 *
 * Note: The backend's generate_subdomain() function is the source of truth.
 * This function is only used as a fallback when the auto_subdomain field
 * is not available from the API. Always prefer using the auto_subdomain
 * field from the organization object.
 *
 * @param orgId - The organization UUID
 * @returns A memorable subdomain like "swift-cloud-742"
 */
export function generateSubdomain(orgId: string): string {
  const bytes = hashOrgId(orgId);

  // Use bytes to pick indices (same logic as backend)
  const adjIdx = ((bytes[0] * 256 + bytes[1]) % ADJECTIVES.length);
  const nounIdx = ((bytes[2] * 256 + bytes[3]) % NOUNS.length);
  const num = ((bytes[4] * 256 + bytes[5]) % 1000);

  const adjective = ADJECTIVES[adjIdx];
  const noun = NOUNS[nounIdx];
  const numStr = num.toString().padStart(3, "0");

  return `${adjective}-${noun}-${numStr}`;
}

/**
 * Validate a subdomain format
 *
 * @param subdomain - The subdomain to validate
 * @returns true if it matches the {word}-{word}-{000-999} format
 */
export function isValidSubdomainFormat(subdomain: string): boolean {
  const parts = subdomain.split("-");
  if (parts.length !== 3) return false;

  const [adj, noun, num] = parts;

  // Check number format (3 digits)
  if (num.length !== 3 || !/^\d{3}$/.test(num)) return false;

  // Check that words are alphanumeric
  if (!/^[a-z]+$/.test(adj) || !/^[a-z]+$/.test(noun)) return false;

  return true;
}
