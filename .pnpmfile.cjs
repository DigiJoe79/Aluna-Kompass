// Optionale Peer-Abhaengigkeiten, die pnpm sonst aus dem Workspace aufloest.
//
// Liegt ein optionaler Peer irgendwo im Workspace, verknuepft pnpm ihn mit dem
// Paket, das ihn anbietet — auch in einer `--prod`-Installation, weil die
// Aufloesung im Lockfile steht. So kamen Playwright (Peer von `next`, nur fuer
// dessen experimentellen Testmodus) und tsx (Peer von `vite`, nur als
// Konfigurationslader) ins Laufzeit-Image, obwohl beides nur Entwicklungs-
// werkzeug ist (Release-Pruefung Q5, `scripts/image-runtime-only.sh`).
const UNUSED_OPTIONAL_PEERS = {
  next: ['@playwright/test'],
  vite: ['tsx'],
};

function readPackage(pkg) {
  for (const peer of UNUSED_OPTIONAL_PEERS[pkg.name] ?? []) {
    if (pkg.peerDependenciesMeta?.[peer]?.optional) {
      delete pkg.peerDependencies[peer];
      delete pkg.peerDependenciesMeta[peer];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
