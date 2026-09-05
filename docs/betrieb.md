# Betrieb auf dem QNAP TS-873

## Erstinstallation
1. Container Station öffnen → „Anwendung erstellen" → Inhalt von `docker-compose.yml` einfügen, `OWNER` ersetzen.
2. Ordner anlegen: `/share/Container/kompass-test/{data,media}` und `/share/Container/kompass-prod/{data,media}`.
3. `.env.test` und `.env.prod` neben die Compose-Datei legen, jeweils `SESSION_SECRET=<48 zufällige Zeichen>` (z. B. `openssl rand -hex 24`).
4. Anwendung starten. Test: `http://<nas>:3001`, Prod: `http://<nas>:3000`. Der erste Aufruf zeigt die Einrichtungsseite (genau einmal).
5. Health: `http://<nas>:3000/api/health`.

## Update
1. In Prod ein Backup exportieren (Verwaltung → Backup → Export erstellen) und die Datei sichern.
2. Container Station: Image `ghcr.io/OWNER/aluna-kompass:<version>` ziehen, zuerst `kompass-test` neu erstellen, prüfen (Login, Startseite, Health), dann `kompass-prod`.
3. Migrationen laufen beim Start automatisch; der Migrationsstand steht im Health-JSON und im Umgebungsbalken der Testumgebung.

## Prod nach Test kopieren
Export in Prod → Datei herunterladen → in Test unter Verwaltung → Backup importieren (Umgebungsname `test` eintippen). Danach sind in Test alle Sitzungen beendet; Anmeldung mit den Prod-Zugangsdaten. API-Tokens werden nicht mitkopiert.

## Backups
- Anwendungs-Backup: Export-Datei (`kompass-backup-<env>-<datum>.tar.gz`) — enthält DB, Medien, Manifest; ohne Sitzungen und Tokens.
- NAS-Ebene: Snapshots des Shared Folders `Container` zusätzlich aktivieren (Volume-Konsistenz: SQLite im WAL-Modus ist snapshot-sicher, das Backup-Export ist aber die verlässliche Form).
- Nach einem Import bleiben die vorherigen Dateien als `kompass.db.before-import-<zeit>` und `media.before-import-<zeit>` liegen; nach Prüfung manuell löschen.

## Zugriff von außerhalb
Nicht vorgesehen. Bei Bedarf QNAP-VPN (QVPN) verwenden; die App selbst bleibt LAN-only und ohne TLS.

## MCP
Endpunkt `http://<nas>:3000/mcp` (Streamable HTTP), Authentifizierung mit einem persönlichen API-Token aus dem Profil (`Authorization: Bearer akx_live_…`). Tokens wirken mit den Rechten des Nutzers; jeder Vorgang steht im Änderungsprotokoll mit Kanal „MCP".

## Webseite (Staging und Live)

1. Bei IONOS zwei Verzeichnisse anlegen: `…/staging` (Subdomain `staging.aluna-tierhilfe.org` darauf zeigen lassen) und das Live-Verzeichnis der Hauptdomain. SSH-Zugang im IONOS-Kundencenter aktivieren.
2. Auf dem NAS ein SSH-Schlüsselpaar erzeugen (`ssh-keygen -t ed25519 -f site.key -N ""`), den öffentlichen Schlüssel bei IONOS hinterlegen (`~/.ssh/authorized_keys` des Webspace-Nutzers), `site.key` nach `/share/Container/kompass-test/` **und** `/share/Container/kompass-prod/` legen (Rechte 600, Besitzer UID 1000 = `node`).
3. `.env.test` und `.env.prod` um die `SITE_*`-Variablen ergänzen (siehe `.env.*.example`). Ohne diese Variablen zeigt Kompass nur „Vorschau", keinen Publish-Knopf.
4. Erster Publish aus Test nach Staging; im Browser prüfen (Staging trägt `noindex`). Dann aus Prod auf Live.
5. Beim Wechsel von WordPress: Live-Verzeichnis vorher umbenennen (`aluna` → `aluna-wordpress-alt`), neues Verzeichnis anlegen, Domain darauf zeigen, dann publizieren. Das alte Verzeichnis nach einer Woche löschen.
6. Fehlersuche: Publizieren-Seite → Historie → Protokoll. Häufige Ursachen: Schlüsselrechte, falscher `SITE_DEPLOY_PATH`, Host-Key-Wechsel (dann `known_hosts` im Container löschen: `docker exec kompass-prod rm -f /home/node/.ssh/known_hosts`).
7. Bildcache: `/data/site-cache` darf jederzeit gelöscht werden; der nächste Build erzeugt ihn neu (dauert dann länger).