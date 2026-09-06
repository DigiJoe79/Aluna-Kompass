# Betrieb auf dem QNAP TS-873

## Erstinstallation
1. Container Station öffnen → **„Anwendung erstellen"** → Inhalt von `docker-compose.yml` einfügen.

   Nicht über „Image erstellen" gehen: die Image-Suche der Container Station bietet nur Docker Hub und die LXD-Registry an. Eine Anwendung zieht dagegen jede Registry, die im Compose steht. `ghcr.io/digijoe79/aluna-kompass` ist öffentlich lesbar, eine Anmeldung ist also nicht nötig.

   Bei einem privaten Paket wäre stattdessen einmalig ein Login über SSH nötig: `docker login ghcr.io -u <github-benutzer>` mit einem Token, das `read:packages` erlaubt.
2. Ordner anlegen: `/share/Container/kompass-test/{data,media}` und `/share/Container/kompass-prod/{data,media}`.
3. `.env.test` und `.env.prod` neben die Compose-Datei legen, jeweils `SESSION_SECRET=<48 zufällige Zeichen>` (z. B. `openssl rand -hex 24`).
4. Anwendung starten. Test: `http://<nas>:3001`, Prod: `http://<nas>:3000`. Der erste Aufruf zeigt die Einrichtungsseite (genau einmal).
5. Health: `http://<nas>:3000/api/health`.

## Update
1. In Prod ein Backup exportieren (Verwaltung → Backup → Export erstellen) und die Datei sichern.
2. Container Station: Anwendung neu bereitstellen, damit das Image neu gezogen wird — `kompass-test` folgt dem Tag `dev`, `kompass-prod` dem Tag `latest`. Zuerst Test neu erstellen, prüfen (Login, Startseite, Health), dann `kompass-prod`.
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

## Webseite (Test und Prod)

Beide Umgebungen liegen als Subdomains auf demselben IONOS-Webspace, die
Hauptdomain bleibt bis zum Go-live auf WordPress.

| Umgebung | Subdomain | Verzeichnis | `SITE_STAGING` |
|---|---|---|---|
| Test | `test.aluna-tierhilfe.org` | `/kunden/homepages/<NN>/<dNNNNNNNNN>/htdocs/aluna-test` | `1` |
| Prod | `prod.aluna-tierhilfe.org` | `/kunden/homepages/<NN>/<dNNNNNNNNN>/htdocs/aluna-prod` | `1` bis zum Go-live |

1. Subdomains bei IONOS auf die beiden Verzeichnisse zeigen lassen, SSH-Zugang im Kundencenter aktivieren.
2. **Anmeldung:** IONOS-Webhosting bietet keine SSH-Schlüssel, deshalb Passwort-Login. Das Webspace-Passwort in eine Datei `site.pw` schreiben (nur die Zeile mit dem Passwort, kein Zeilenumbruch nötig) und nach `/share/Container/kompass-test/` **und** `/share/Container/kompass-prod/` legen, Rechte 600, Besitzer UID 1000 (`node`):

   ```
   printf '%s' '<webspace-passwort>' > site.pw && chmod 600 site.pw && chown 1000:1000 site.pw
   ```

   Kompass ruft `sshpass -f /data/site.pw rsync …` auf; das Passwort steht damit nie in der Prozessliste und nicht in `docker inspect`. Auf einem Hoster mit Schlüsselanmeldung stattdessen `SITE_DEPLOY_KEY_FILE` setzen — der Code beherrscht beides.
3. `.env.test` und `.env.prod` um die `SITE_*`-Variablen ergänzen (siehe `.env.*.example`). Ohne diese Variablen zeigt Kompass nur „Vorschau", keinen Publish-Knopf.
4. **Prod trägt vorerst `SITE_STAGING=1`.** Ohne das wäre `prod.aluna-tierhilfe.org` indexierbar und stünde später in Konkurrenz zur echten Domain. Der Schalter setzt `noindex`, `Disallow: /` und lässt die Sitemap weg.
5. Erster Publish aus Test nach `…/aluna-test`, im Browser prüfen. Das ist zugleich der erste Lauf von rsync über SSH — bei Fehlern siehe Punkt 8. Danach dasselbe aus Prod nach `…/aluna-prod`.
6. **Go-live** (nach der e.V.-Eintragung, wenn die Seite abgenommen ist): Hauptdomain von WordPress auf `…/aluna-prod` umstellen, in `.env.prod` `SITE_PUBLIC_URL=https://aluna-tierhilfe.org` setzen und `SITE_STAGING` entfernen, Container neu starten, einmal publizieren. Erst dann steht die Seite im Index. Das WordPress-Verzeichnis eine Woche aufbewahren, dann löschen.
7. **Am 2026-09-06 manuell gegen `…/aluna-test` verifiziert:** Passwort-Login, rsync (hier openrsync, dort 3.4.1), Zielpfad, `--delete`, Auslieferung von HTML, `.woff2`, `.webp` und die `.htaccess`-Auswertung. Der Weg funktioniert also; im Container ändert sich nur, dass `sshpass` das Passwort aus `/data/site.pw` liefert.
8. Fehlersuche: Publizieren-Seite → Historie → Protokoll. Häufige Ursachen: Schlüsselrechte, falscher `SITE_DEPLOY_PATH`, Host-Key-Wechsel (dann `known_hosts` im Container löschen: `docker exec kompass-prod rm -f /home/node/.ssh/known_hosts`). Beim Nachstellen von Hand: rsync schweigt bei Erfolg — ohne `-v` sieht ein geglückter Lauf wie ein wirkungsloser aus.
9. Bildcache: `/data/site-cache` darf jederzeit gelöscht werden; der nächste Build erzeugt ihn neu (dauert dann länger).