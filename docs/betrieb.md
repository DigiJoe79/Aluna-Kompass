# Betrieb auf dem QNAP TS-873

## Erstinstallation
1. **Ordner anlegen**: `/share/Container/kompass-test/{data,media}` (Prod analog, erst wenn Test läuft).
2. **`.env.test`** nach `/share/Container/kompass-test/` legen (Vorlage `.env.test.example`), mit `SESSION_SECRET=<48 zufällige Zeichen>`, z. B. `openssl rand -hex 24`. Je Umgebung ein eigener Wert, sonst gälten Sitzungen aus Test auch in Prod.
3. **`site.pw`** daneben: `printf '%s' '<webspace-passwort>' > site.pw && chmod 600 site.pw && chown 1000:1000 site.pw`. `printf` statt `echo`, sonst hängt ein Zeilenumbruch am Passwort.
4. Container Station öffnen → **„Anwendung erstellen"** → Inhalt von `docker-compose.test.yml` einfügen. Für Prod später eine **zweite Anwendung** aus `docker-compose.prod.yml`.

   Nicht über „Image erstellen" gehen: die Image-Suche der Container Station bietet nur Docker Hub und die LXD-Registry an. Eine Anwendung zieht dagegen jede Registry, die im Compose steht. `ghcr.io/digijoe79/aluna-kompass` ist öffentlich lesbar, eine Anmeldung ist also nicht nötig.

   Die Pfade im Compose sind absolut. Die Container Station kopiert die Datei nach `/tmp`, wo ein relatives `env_file` ins Leere zeigt — der Fehler lautet dann `env file /tmp/.env.… not found`.

   Bei einem privaten Paket wäre stattdessen einmalig ein Login über SSH nötig: `docker login ghcr.io -u <github-benutzer>` mit einem Token, das `read:packages` erlaubt.
5. Anwendung starten. Test: `http://<nas>:3001`, Prod: `http://<nas>:3000`. Der erste Aufruf zeigt die Einrichtungsseite (genau einmal).
6. Health: `http://<nas>:3000/api/health`.

## Update

1. In Prod ein Backup exportieren (Verwaltung → Backup → Export erstellen) und die Datei sichern.
2. Anwendung neu bereitstellen — `kompass-test` folgt dem Tag `dev`, `kompass-prod` dem Tag `latest`. Zuerst Test, prüfen (Login, Startseite, Health), dann Prod.

   **Wichtig:** `dev` und `latest` sind bewegliche Tags. Ein Neustart oder ein Neuanlegen der Anwendung startet sonst weiter das lokal zwischengespeicherte Image. Die Compose-Dateien setzen deshalb `pull_policy: always`. Wenn die Container Station das ignoriert, hilft der Weg über SSH:

   ```
   docker compose -f docker-compose.test.yml pull
   docker compose -f docker-compose.test.yml up -d
   ```

   Ob wirklich die neue Fassung läuft, verrät `/api/health` oder `docker image inspect ghcr.io/digijoe79/aluna-kompass:dev --format '{{.Id}}'` im Vergleich zur Ausgabe des CI-Laufs.

   Wer es ganz eindeutig will, trägt statt `dev` den unveränderlichen Tag `sha-<commit>` ein — dann ist jede Aktualisierung eine sichtbare Änderung der Compose-Datei.
3. Migrationen laufen beim Start automatisch; der Migrationsstand steht im Health-JSON und im Umgebungsbalken der Testumgebung.
4. Die Bilder unter `:dev` und `:latest` sind vor dem Hochladen auf amd64 durchgetestet (siehe „Bauen und Prüfen"). Ein rotes CI-Ergebnis heißt deshalb: Es gibt kein neues Bild, nicht etwa ein ungeprüftes.

## Prod nach Test kopieren
Export in Prod → Datei herunterladen → in Test unter Verwaltung → Backup importieren (Umgebungsname `test` eintippen). Danach sind in Test alle Sitzungen beendet; Anmeldung mit den Prod-Zugangsdaten. API-Tokens werden nicht mitkopiert.

## Backups
- Anwendungs-Backup: Export-Datei (`kompass-backup-<env>-<datum>.tar.gz`) — enthält DB, Medien, Manifest; ohne Sitzungen und Tokens.
- NAS-Ebene: Snapshots des Shared Folders `Container` zusätzlich aktivieren (Volume-Konsistenz: SQLite im WAL-Modus ist snapshot-sicher, das Backup-Export ist aber die verlässliche Form).
- Nach einem Import bleiben die vorherigen Dateien als `kompass.db.before-import-<zeit>` und `media.before-import-<zeit>` liegen; nach Prüfung manuell löschen.

## Zugriff von außerhalb
Nicht vorgesehen. Bei Bedarf QNAP-VPN (QVPN) verwenden; die App selbst bleibt LAN-only und ohne TLS.

## Bauen und Prüfen

Drei Ringe, jeder prüft eine andere Schicht:

| Ring | Befehl | Wogegen |
|---|---|---|
| Logik | `pnpm test` | Quellcode |
| Abläufe | `pnpm --filter @kompass/app e2e` | `next dev` |
| Verpackung | `pnpm e2e:image` | dem gebauten Image im Container |

`pnpm verify` fährt alle drei plus den Image-Build und braucht rund zwei
Minuten. **Vor jedem Push.**

Der dritte Ring braucht Docker. Er startet `kompass-local` auf Port 3200 mit
frischen Volumes und prüft, was nur im Container schiefgehen kann: gebündelter
Code, `/data`, das mitgelieferte Template und die Modulauflösung aus dem
Entrypoint. `/data` und `/media` bekommen anonyme Volumes, damit jeder Lauf
eine Erstinbetriebnahme ist; eingehängt wird nur das Publish-Ziel unter
`apps/kompass/.e2e-container/deploy`, weil der Test dort nachsieht.

Für ein Ausprobieren von Hand gibt es `pnpm dev:image` — eine **stehende**
Installation auf Port 3300 mit Daten, die Neustarts überleben, und mit
demselben Verhalten wie der Testcontainer auf dem NAS. `pnpm dev:image down`
beendet sie, `reset` verwirft auch die Daten.

Die CI wiederholt Ring eins und zwei auf frischem Checkout und fährt Ring drei
im `image`-Job gegen die **amd64**-Fassung, bevor sie hochgeladen wird — lokal
baut ein Apple-Silicon-Rechner arm64, und `better-sqlite3`, `sharp` und Typst
sind je Architektur andere Dateien. Sie lädt das gebaute Bild dafür erst in den
lokalen Daemon und vergibt die Namen danach an genau dieses Bild. Damit gilt:

> **Liegt ein Bild unter `:dev` oder `:latest`, sind seine Tests grün gelaufen
> und es hat auf amd64 alle Browserfälle bestanden.**

Laufzeiten: `pnpm verify` lokal rund zwei Minuten; die CI etwa neun Minuten,
bei geänderten Abhängigkeiten etwa siebzehn — dann baut die Deps-Schicht des
Images `better-sqlite3` und `sharp` neu. Die Begründung der Aufteilung steht in
`docs/superpowers/specs/2026-09-08-pruefringe-design.md`.

## MCP
Endpunkt `http://<nas>:3000/mcp` (Streamable HTTP), Authentifizierung mit einem persönlichen API-Token aus dem Profil (`Authorization: Bearer akx_live_…`). Tokens wirken mit den Rechten des Nutzers; jeder Vorgang steht im Änderungsprotokoll mit Kanal „MCP".

## Webseite (Test und Prod)

**Das Template unter `/data/site-template`.** Kompass pflegt nicht die Seite,
sondern die Inhalte, die ein Astro-Template deklariert. Beim ersten Start legt
der Entrypoint das mitgelieferte Basis-Template dort ab; ein vorhandenes bleibt
unberührt, auch bei einem Update. Der Verein ersetzt es durch sein eigenes und
liest es unter Webseite → Template ein.

Dieses Verzeichnis ist eine **Vertrauensgrenze**: Der Build führt den Code des
Templates aus, mit den Rechten des Containers. Wer dorthin schreiben darf, kann
im Container Code ausführen. Es gehört deshalb `node` (UID 1000) und niemandem
sonst, und es wird nicht über eine Freigabe geteilt.

`node_modules` darin ist ein Symlink auf die Module des Images. Zeigt er ins
Leere — etwa nach einem Update aus einer älteren Fassung —, erneuert ihn der
Entrypoint beim nächsten Start selbst; ein Build meldete das vorher als
„astro not installed".

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

   Der `chown` ist nicht optional: der Container laeuft als UID 1000 (`node`), die Eigentuemerschaft kommt vom Wirtssystem, und die Datei ist schreibgeschuetzt eingehaengt. Gehoert sie `root`, kann Kompass sie nicht lesen. Pruefen mit:

   ```
   docker exec kompass-test sh -c 'ls -l /data/site.pw; wc -c < /data/site.pw'
   ```

   Kompass ruft `sshpass -f /data/site.pw rsync -az --no-owner --no-group --no-perms --omit-dir-times --delete --checksum …` auf. Die vier `--no…`-Flaggen nehmen `-a` das, was es am **Zielverzeichnis selbst** setzen will: Besitzer, Gruppe, Rechte, Zeitstempel. Gehört das Verzeichnis jemand anderem oder ist es ein Einhängepunkt, bricht der Lauf sonst mit „Operation not permitted" ab, obwohl jede Datei übertragen wurde. Zeitstempel und Symlinks der Dateien bleiben erhalten. das Passwort steht damit nie in der Prozessliste und nicht in `docker inspect`. Auf einem Hoster mit Schlüsselanmeldung stattdessen `SITE_DEPLOY_KEY_FILE` setzen — der Code beherrscht beides.
3. `.env.test` und `.env.prod` um die `SITE_*`-Variablen ergänzen (siehe `.env.*.example`). Ohne diese Variablen zeigt Kompass nur „Vorschau", keinen Publish-Knopf.
4. **Prod trägt vorerst `SITE_STAGING=1`.** Ohne das wäre `prod.aluna-tierhilfe.org` indexierbar und stünde später in Konkurrenz zur echten Domain. Der Schalter setzt `noindex`, `Disallow: /` und lässt die Sitemap weg.
5. **Vor dem ersten Publish:** Publizieren-Seite → „Verbindung testen“. Der Lauf meldet sich am Ziel an und überträgt nichts; er listet auf, was dort liegt und ein Publish entfernen würde. Steht die erwartete Installation darin, stimmt der Pfad. Kommt die Liste leer zurück, zeigt `SITE_DEPLOY_PATH` ins Leere — ein vertippter Pfad lässt rsync nicht scheitern, er trifft nur nichts.
6. Erster Publish aus Test nach `…/aluna-test`, im Browser prüfen. Das ist zugleich der erste Lauf von rsync über SSH — bei Fehlern siehe Punkt 9. Danach dasselbe aus Prod nach `…/aluna-prod`.
7. **Go-live** (nach der e.V.-Eintragung, wenn die Seite abgenommen ist): Hauptdomain von WordPress auf `…/aluna-prod` umstellen, in `.env.prod` `SITE_PUBLIC_URL=https://aluna-tierhilfe.org` setzen und `SITE_STAGING` entfernen, Container neu starten, einmal publizieren. Erst dann steht die Seite im Index. Das WordPress-Verzeichnis eine Woche aufbewahren, dann löschen.
8. **Am 2026-09-06 manuell gegen `…/aluna-test` verifiziert:** Passwort-Login, rsync (hier openrsync, dort 3.4.1), Zielpfad, `--delete`, Auslieferung von HTML, `.woff2`, `.webp` und die `.htaccess`-Auswertung. Der Weg funktioniert also; im Container ändert sich nur, dass `sshpass` das Passwort aus `/data/site.pw` liefert.
9. Fehlersuche: erst „Verbindung testen“, dann Publizieren-Seite → Historie → Protokoll. Häufige Ursachen: Schlüsselrechte, falscher `SITE_DEPLOY_PATH`, Host-Key-Wechsel (dann `known_hosts` im Container löschen: `docker exec kompass-prod rm -f /home/node/.ssh/known_hosts`). Beim Nachstellen von Hand: rsync schweigt bei Erfolg — ohne `-v` sieht ein geglückter Lauf wie ein wirkungsloser aus.
10. **MCP prüfen** (nach jedem Update sinnvoll): `pnpm --filter @kompass/app mcp:check http://<nas>:3001` meldet, ob der Endpunkt erreichbar ist und unangemeldete Anfragen ablehnt. Mit einem API-Token als zweitem Argument verbindet es sich, listet die Werkzeuge und ruft eines lesend auf — die Zahl der Werkzeuge zeigt zugleich, ob die Fachmodule aktiv sind. Das Token danach unter Profil → API-Token widerrufen.
11. Bildcache: `/data/site-cache` darf jederzeit gelöscht werden; der nächste Build erzeugt ihn neu (dauert dann länger).