import type { BranchOption } from "./backend";
// Shown instantly, before the server answers; same list as migration
// 0010_seed_branches. The server's list then replaces it.
const SEEDED = [
  ["arcot", "ARCOT"],
  ["arni-1", "ARNI-1"],
  ["arni-2", "ARNI-2"],
  ["arni-3", "ARNI-3"],
  ["avalurpet", "AVALURPET"],
  ["chengam", "CHENGAM"],
  ["chetpet", "CHETPET"],
  ["dharmapuri", "DHARMAPURI"],
  ["gudiyatham", "GUDIYATHAM"],
  ["kannamangalam", "KANNAMANGALAM"],
  ["krishnagiri", "KRISHNAGIRI"],
  ["pallikonda", "PALLIKONDA"],
  ["polur", "POLUR"],
  ["puducherry", "PUDUCHERRY"],
  ["ranipet-1", "RANIPET-1"],
  ["ranipet-2", "RANIPET-2"],
  ["sholinghur", "SHOLINGHUR"],
  ["thirupattur-1", "THIRUPATTUR-1"],
  ["thirupattur-2", "THIRUPATTUR-2"],
  ["thiruthani", "THIRUTHANI"],
  ["thiruvannamalai-1", "THIRUVANNAMALAI-1"],
  ["thiruvannamalai-2", "THIRUVANNAMALAI-2"],
  ["thiruvannamalai-3", "THIRUVANNAMALAI-3"],
  ["thiruvannamalai-4", "THIRUVANNAMALAI-4"],
  ["uthiramerur", "UTHIRAMERUR"],
  ["vellore-1", "VELLORE-1"],
  ["vellore-2", "VELLORE-2"],
  ["vellore-3", "VELLORE-3"],
  ["vellore-4", "VELLORE-4"],
  ["vellore-5", "VELLORE-5"],
  ["walajapet", "WALAJAPET"],
];
const KEY = "sky-branches";
export function initialBranches(): BranchOption[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(saved) && saved.length) return saved as BranchOption[];
  } catch {
    // Nothing usable saved: the built-in list below is fine.
  }
  return SEEDED.map(([slug, name]) => ({ slug, name }));
}
export function saveBranches(list: BranchOption[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: next visit starts from the built-in list.
  }
}
