import type { BranchOption } from "./backend";
// Shown instantly, before the server answers; same list as migration
// 0010_seed_branches, with store numbers from 0016. The server's list then
// replaces it.
const SEEDED = [
  ["arcot", "ARCOT", "9361373727"],
  ["arni-1", "ARNI-1", "8754750009"],
  ["arni-2", "ARNI-2", "9361684885"],
  ["arni-3", "ARNI-3", "6383941914"],
  ["avalurpet", "AVALURPET", "9123525312"],
  ["chengam", "CHENGAM", "9655895592"],
  ["chetpet", "CHETPET", "8754740009"],
  ["dharmapuri", "DHARMAPURI", "9080349183"],
  ["gudiyatham", "GUDIYATHAM", "7845082979"],
  ["kannamangalam", "KANNAMANGALAM", "8489492300"],
  ["krishnagiri", "KRISHNAGIRI", "7695866652"],
  ["pallikonda", "PALLIKONDA", "9790102001"],
  ["polur", "POLUR", "9361358553"],
  ["puducherry", "PUDUCHERRY", "8778829472"],
  ["ranipet-1", "RANIPET-1", "9025431811"],
  ["ranipet-2", "RANIPET-2", "8667670649"],
  ["sholinghur", "SHOLINGHUR", "9344799353"],
  ["thirupattur-1", "THIRUPATTUR-1", "8778333903"],
  ["thirupattur-2", "THIRUPATTUR-2", "8248205223"],
  ["thiruthani", "THIRUTHANI", "9043451343"],
  ["thiruvannamalai-1", "THIRUVANNAMALAI-1", "8754905008"],
  ["thiruvannamalai-2", "THIRUVANNAMALAI-2", "9025244200"],
  ["thiruvannamalai-3", "THIRUVANNAMALAI-3", "7904741512"],
  ["thiruvannamalai-4", "THIRUVANNAMALAI-4", "7010141694"],
  ["uthiramerur", "UTHIRAMERUR", "8925778780"],
  ["vellore-1", "VELLORE-1", "8754740006"],
  ["vellore-2", "VELLORE-2", "8754780007"],
  ["vellore-3", "VELLORE-3", "8754740002"],
  ["vellore-4", "VELLORE-4", "8754966941"],
  ["vellore-5", "VELLORE-5", "9361553446"],
  ["walajapet", "WALAJAPET", "9150363646"],
];
// v2: the saved list now carries store numbers.
const KEY = "sky-branches-v2";
export function initialBranches(): BranchOption[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(saved) && saved.length) return saved as BranchOption[];
  } catch {
    // Nothing usable saved: the built-in list below is fine.
  }
  return SEEDED.map(([slug, name, phone]) => ({ slug, name, phone }));
}
export function saveBranches(list: BranchOption[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: next visit starts from the built-in list.
  }
}
