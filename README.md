# ❄ LAN TD

Kooperatives 3D-Maze-Tower-Defense im Browser für **bis zu 16 Spieler im lokalen Netzwerk**, nachempfunden der
Warcraft-III-Karte **Wintermaul TD** („LAN TD“): verschneite Karte, Gegner aus mehreren Portalen im Norden, ein Tor im Süden –
und kein fester Weg, sondern **Labyrinthe (Mazes)**, die die Spieler selbst bauen.

Ein Rechner startet den Server, alle anderen öffnen einfach die angezeigte Adresse im Browser – keine Installation
auf den Mitspieler-Rechnern nötig. Alternativ spielt man ohne eigenen Server **online** auf
[td.rennecke.org](https://td.rennecke.org) (siehe [Online-Modus](#online-modus-tdrenneckeorg)).

## Schnellstart (Host)

Voraussetzung: [Node.js](https://nodejs.org/) **22 LTS** (oder 20.19+) auf dem Host-Rechner.

```bash
npm install
npm start
```

Unter Windows geht auch ein Doppelklick auf **`Start-Server.cmd`**.

Der Server zeigt beim Start die Adressen an, z. B.:

```
  Lokal:   http://localhost:3000
  Im LAN:  http://192.168.0.33:3000
```

Mitspieler öffnen die **LAN-Adresse** in Chrome, Edge oder Firefox. Anderer Port: `npm start -- 8080` oder
Umgebungsvariable `PORT=8080`.

### Windows-Firewall

Beim ersten Start fragt Windows meist nach einer Freigabe für Node.js – **„Private Netzwerke“ erlauben**.
Falls Mitspieler trotzdem nicht verbinden können (als Administrator ausführen):

```powershell
netsh advfirewall firewall add rule name="LAN TD" dir=in action=allow protocol=TCP localport=3000
```

## Spielablauf

1. **Lobby:** Jeder Spieler bekommt automatisch eine **zufällige Klasse** (änderbar), klickt „Bereit“ – der Host (👑) wählt die
   **Karte** und startet das Spiel. Auf der großen Kartenvorschau kann jeder ein **✖ setzen**, um den anderen zu zeigen,
   wo er gerne spielen würde (die Kamera startet dort). Es gibt **keine festen Bereiche**: jeder darf überall bauen.
   Der Host kann Spieler, die nicht „Bereit“ klicken, mit ✖ aus der Lobby **entfernen** (kicken).
2. **Karten** (Northrend-Look: verschneite Plateaus mit Felskanten, Eispfade, zugefrorenes Wasser):
   - **Wintermaul X9** – die klassische Karte: drei Portale im Norden, darunter ein breites Mittelfeld mit
     Eiskanälen, der große Felsgraben (∩) zwingt die Gegner links oder rechts herum, das Tor liegt im See im Süden.
   - **Wintermaul X9 XL** – dasselbe Layout wie X9, aber 1,6-mal so groß (80×80 Felder): viel mehr Platz für lange Labyrinthe.
   - **Nordend (4 Spuren)** – vier getrennte Spuren zwischen Eisklippen, unten ein gemeinsamer Trichter zum Tor.
   - **Zwillingsgletscher** – zwei Spuren biegen nach innen ab und vereinen sich zu einer Schlucht nach Süden.

   Je nach Spielerzahl sind 1–4 Portale aktiv (z. B. X9: 1 Spieler = Mitte, 2 Spieler = links/rechts, ab 3 alle drei).
   Jedes aktive Portal schickt die **komplette Welle**; die Lebenspunkte der Gegner skalieren mit der Spielerzahl pro Spur.
3. **Mazing:** Es gibt keinen festen Pfad. Bodengegner laufen immer den kürzesten Weg um die Türme herum. Mit billigen
   **Mauerblöcken** (5 Gold, Taste 1) baut man Wände mit Lücken, sodass die Gegner Schlangenlinien laufen müssen.
   - Die **rote gestrichelte Linie** zeigt den aktuellen Weg, im Baumenü steht die **Weglänge** je Spur.
   - Den Weg komplett zu **blockieren** ist nicht erlaubt (das Bau-Feld wird rot). Auch auf Gegnern kann man nicht bauen.
   - **Flieger** ignorieren Türme und fliegen über Wasser, **umfliegen aber Felsen und Hügel** auf dem Weg zum Tor.
4. **40 Wellen** mit immer stärkeren Gegnern – alle 10 Wellen ein **Boss**. Danach geht es im **Endlos-Modus**
   weiter; der **Rekord** (erreichte Welle) wird **pro Karte** gespeichert.
5. Durchgelassene Gegner kosten **gemeinsame Leben** (50, +10 je weiterer aktiver Spur). Bei 0 ist das Spiel verloren.

### Wirtschaft

- **Gold** ist pro Spieler (Start: 450). Jeder Kill bringt **allen** Spielern Gold (geteilt durch die Zahl der aktiven Spuren,
  damit das Einkommen nicht von der Kartenbelegung abhängt).
- **Gold senden:** Im Menü (☰ → 💸) kann jeder einem Mitspieler Gold schicken.
- Zu Beginn jeder Welle gibt es Einkommen (+ Goblin-Bank/Investitionen) und **Holz**.
- **Holz** braucht man für Forschung und die Ultimate-Türme. Besiegte Bosse geben allen +2 Holz.
- Verkaufen erstattet 75 % der Investition.

### Kampfsystem (wie WC3)

Angriffstypen (Normal, Durchbohren, Belagerung, Magie, Chaos) gegen Rüstungstypen (Ungerüstet, Leicht, Mittel,
Schwer, Befestigt, Held) – die Tabelle steht in der Lobby. Dazu kommen Rüstungswerte nach der WC3-Formel und
Spezialgegner:

| Gegner-Eigenschaft | Was hilft |
|---|---|
| **Luft** | Türme mit Ziel „Luft“ (z. B. die Lufttürme der Klassen) |
| **Unsichtbar** | Türme mit **Erkennung** in der Nähe (Arkaner Turm, Schamane, Obsidianstatue, Mondbrunnen, Dryadenhain, Luftturm, Teslaspule) |
| **Magieimmun** | Kein Magie-Schaden, keine Slows/Betäubungen – Belagerung/Chaos benutzen |
| **Heiler / Regeneration** | Schaden bündeln, Fokus „Stärkster“ |
| **Teilt sich** | Flächenschaden |

### Klassen

| Klasse | Stil | Türme |
|---|---|---|
Wie in Wintermaul baut jede Rasse mit ihrem eigenen Baumeister. Slot 1 ist immer ein billiger Mauerblock zum Mazen.

| Klasse (Baumeister) | Stil | Mauerblock | Türme |
|---|---|---|---|
| 🛡️ **Allianz** (Bauer) | Allrounder | Steinwall | Pfeilturm, Kanonenturm, Arkaner Turm, Kirche (Tempo-Aura), Luftturm, *Erzmagierturm* |
| 🪓 **Horde** (Peon) | Rohe Gewalt | Palisade | Speerturm, Katapult, Kriegstrommel (Schadens-Aura), Blitzturm, Luftturm, *Festung des Häuptlings* |
| ☠️ **Geißel** (Akolyth) | Debuffs | Knochenwall | Geisterturm, Giftturm, Frostturm, Fleischwagen, Obsidianstatue, *Frostthron* |
| 🌙 **Nachtelfen** (Irrlicht) | Natur & Auren | Dornenhecke | Mondpfeilturm, Mondbrunnen, Dornenranke, Dryadenhain, Luftturm, *Weltenbaum* |
| 🔥 **Elementarist** (Golem) | Elemente | Eisblock | Flammenturm, Wasserturm, Felsturm, Luftturm, *Magmaturm (Fusion)*, *Elementarvortex* |
| ⚙️ **Goblins** (Schredder) | Technik & Profit | Schrottbarrikade | Maschinengewehr, Raketenturm, Teslaturm, Minenleger, Goblin-Bank, *Zeppelin-Werft* |

Jeder Turm hat **3 Stufen** (Mauerblöcke nur eine). Jede Klasse hat **4 Forschungen** (globale Boni und die Freischaltung des Ultimate-Turms).

### Steuerung

| Taste | Aktion |
|---|---|
| **1** | Mauerblock zum Mazen |
| **2–7** | Turm zum Bauen wählen |
| **Linksklick** | Bauen (der Turmtyp bleibt gewählt, **Esc** / Rechtsklick beendet) / Turm auswählen; **mit der Maus ziehen** = Auswahlrahmen für mehrere Türme (**Shift** = zur Auswahl hinzufügen) |
| **Pfeiltasten** | Cursor bewegen (**Shift** = 5 Felder), immer aktiv; der Turm unter dem Cursor wird sofort geöffnet, die Kamera folgt am Rand, **WASD** bewegt sie weiter |
| **Enter** / **Leertaste** (im Baumodus) | Turm am Cursor bauen – Turmtyp und Cursorposition bleiben gewählt, so lassen sich mehrere Türme hintereinander setzen; **Esc** beendet den Baumodus |
| **Q** / **E** | Vorherigen / nächsten eigenen Turm wählen (Kamera springt hin) |
| **U** / **V** oder **Entf** / **C** | Gewählten Turm aufwerten / verkaufen / Zielmodus umschalten (bei mehreren gewählten Türmen: alle aufwerten / Zielmodus für alle) |
| **Rechtsklick / Esc** | Bauen abbrechen / Auswahl aufheben |
| **F** | Forschung öffnen; darin kauft **1**–**4** die jeweilige Forschung, **Esc** schließt |
| **N** | Bereit. Die **erste Welle startet erst, wenn alle Spieler bereit sind**; danach startet sie nach dem Countdown oder 3 s nach dem letzten „Bereit“ |
| **F1** | Spielregeln (Überblick und genaue Gold-/Holz-Zahlen) |
| **WASD**, Bildschirmrand, **rechte/mittlere Maustaste ziehen** | Kamera bewegen |
| **Mausrad** | Zoomen |
| **Leertaste** | Kamera zu den Portalen und zum Tor |
| **Alt + Klick** | Ping auf der Karte für alle |
| **Enter** | Chat |
| **B** (halten) | Punktestand |
| **Tab** / **Shift+Tab** | Durch die Buttons springen, **Enter** / **Leertaste** löst den fokussierten Button aus |
| **F10** / ☰ Menü (unten rechts) | Menü: Pause, Speichern, Punktestand, **Laufweg an/aus**, **Bauraster an/aus**, **Gold senden**, **Spielregeln**, Ton, Spiel beenden (Anzeige-Schalter gelten nur für den eigenen Bildschirm und werden gemerkt) |
| **P** | Spiel pausieren / fortsetzen (jeder Spieler) |
| **Strg+S** | Spiel speichern (Menü → 💾) |
| **R** / **G** | Laufweg / Bauraster ein- und ausblenden |
| **T** | Gold an einen Mitspieler senden |
| **M** | Ton an/aus |
| **Shift+Q** | Spiel beenden (nur Host) – fragt: speichern, nicht speichern oder abbrechen; danach sind alle wieder in der Lobby |

Klick auf die Minimap bewegt die Kamera. Bei ausgewählten Türmen lässt sich die Zielwahl einstellen
(Vorderster, Hinterster, Stärkster, Schwächster, Nächster). Die Aufwerten-/Verkaufen-Knöpfe haben feste Größe und Position;
beim Verkaufen direkt nach dem Aufwerten wird ein versehentlicher Doppelklick ignoriert.

### Pause, Speichern & Laden

- **Pause:** Jeder Spieler kann das Spiel mit **P** oder ⏸ anhalten und fortsetzen. Während der Pause stehen
  Gegner und Countdown still; Bauen, Aufwerten, Verkaufen und Forschung sind gesperrt.
- **Speichern:** Mit 💾 jederzeit während des Spiels. Die Spielstände liegen auf dem Server-Rechner im Ordner
  `saves/` (gleicher Name überschreibt den alten Spielstand). Online gehören Spielstände dem **Browser**, in dem
  gespeichert wurde (Schlüssel im localStorage) – jeder sieht in der Lobby nur seine eigenen.
- **Laden:** Der Host 👑 lädt einen Spielstand (inkl. Karte) in der Lobby (Liste „💾 Spielstände“). Spieler übernehmen den
  Platz mit **gleichem Namen**, die übrigen Plätze werden der Reihe nach vergeben. Klassen kommen aus dem Spielstand.
  Unbesetzte Plätze übernehmen später beitretende Spieler automatisch. Ein geladenes Spiel startet pausiert.

### Verbindung, Nachjoinen & Zuschauer

- Bei einem Verbindungsabbruch (oder Neuladen im selben Tab) verbindet sich der Client automatisch neu und übernimmt
  wieder seinen Spieler – Türme und Gold bleiben erhalten.
- **Türme getrennter Spieler gehören allen:** Solange der Besitzer nicht verbunden ist, darf jeder sie aufwerten, verkaufen
  und die Zielwahl ändern.
- **Nachjoinen:** Wer einem laufenden Spiel beitritt, sieht zuerst zu und kann im Baumenü eine Klasse wählen und über
  „⚔ Mitspielen“ einsteigen. Neue Spieler starten mit dem durchschnittlichen Gold der anderen; die Gegner werden mit der
  Spielerzahl etwas stärker. (Beim Laden eines Spielstands übernehmen neue Spieler freie Plätze automatisch.)

### Statistik am Spielende

Zeit, Karte, Leben, besiegte Gegner/Bosse, Gesamtschaden, gebaute/stehende Türme, stärkster Turm, am häufigsten besiegte
und durchgelassene Gegner sowie pro Spieler Kills, Schaden, Türme, Aufwertungen, verdientes und gesendetes Gold.

## Technik

```
shared/   Spieldaten & Regeln (Klassen, Türme, Gegner, Wellen, Karten (maps.ts), Pfadsuche, Schadenstabelle, Protokoll)
server/   Node.js-Server: HTTP für den Client + WebSocket, Lobby, autoritative Simulation (20 Ticks/s)
client/   Browser-Client: Vite + Three.js, prozedurale Low-Poly-Modelle, HUD
tools/    Bots, Balancing-Simulation, Browser-Tests
tests/    Vitest (Regeln, Simulation, Server-Protokoll)
```

- Der **Server ist autoritativ**: Clients schicken nur Befehle (bauen, aufwerten, …). Der Server sendet 10× pro
  Sekunde einen kompakten Snapshot (Gegner als Position auf der Karte), die Clients interpolieren dazwischen.
- Alle Grafiken werden im Code aus einfachen Formen erzeugt – keine externen Assets.
- Bandbreite: ca. 25 KiB/s pro Client bei 16 Spielern.

### Entwicklung

```bash
npm run dev:server       # Server mit Auto-Reload (Port 3000)
npm run dev:client       # Vite-Dev-Server mit Hot-Reload (leitet /ws und /api an Port 3000 weiter)
npm test                 # Unit- und Integrationstests
npm run typecheck        # TypeScript prüfen
npm run bots -- 15 --start     # 15 Bot-Spieler verbinden sich (Lasttest / Lobby füllen)
npm run balance -- 4 45        # Headless-Balancing: 4 Bot-Spieler bis Welle 45
```

Optionale Browser-Tests (benötigen `playwright-core` und Edge):
`npx tsx tools/e2e.ts <pfad-zu-playwright-core>` und `npx tsx tools/spectate.ts <pfad-zu-playwright-core>`.

## Online-Modus (td.rennecke.org)

Derselbe Server läuft mit `TD_MODE=online` als öffentlicher Server mit **beliebig vielen Räumen**:

- Startseite mit **offenen Räumen**, „Raum erstellen“ (öffentlich oder privat) und „Mit Code beitreten“.
- Jeder Raum hat einen 4-stelligen Code und einen Einladungslink, z. B. `https://td.rennecke.org/#K7QD`
  (in der Lobby unter „Mitspieler einladen“ → 🔗 Link kopieren).
- Räume ohne verbundene Spieler werden nach 10 Minuten gelöscht. Rekorde gelten serverweit pro Karte.
- Auf der Startseite gibt es außerdem den **Download für die lokale LAN-Runde** (`/download/lan-td.zip`, enthält den
  fertig gebauten Client; Start mit `Start-Server.cmd` bzw. `./start-server.sh`).

Lokal ausprobieren: `npm run build`, dann `TD_MODE=online npm run server` (PowerShell: `$env:TD_MODE='online'; npm run server`).

| Variable | Standard | Bedeutung |
|---|---|---|
| `TD_MODE` | `lan` | `online` = Räume mit Codes |
| `PORT` | `3000` | HTTP/WebSocket-Port |
| `DATA_DIR` | Projektordner | Ablage für `highscore.json` und `saves/` |
| `SAVE_DIR` | `$DATA_DIR/saves` | Spielstände |
| `TD_ORIGIN` | – | erlaubte Origins (kommagetrennt), z. B. `https://td.rennecke.org` |
| `MAX_ROOMS` / `ROOM_TTL_MIN` | `100` / `10` | max. Räume / Minuten bis ein leerer Raum gelöscht wird |
| `MAX_CONN_PER_IP` / `MAX_ROOMS_PER_IP` | `20` / `10` | Verbindungen je IP / neue Räume je IP in 10 Min. |
| `MSG_RATE` / `MAX_SAVES` | `60` / `20` | Nachrichten pro Sekunde und Verbindung / Spielstände pro Browser |

### Versionen, Changelog und Deployment

- **Version:** `version` in [`package.json`](package.json) (SemVer). Sie steht in Lobby/Raumliste (`v1.1.0 · Neuigkeiten`),
  im Spielmenü (F10) und in `/api/config`. Branch-Builds heißen `1.1.0-dev.<sha>`, lokale Builds `1.1.0-local`.
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md) – nur spielrelevante Änderungen, neue Einträge oben. Das Spiel zeigt die
  Datei direkt an (Klick auf die Version bzw. „🆕 Neuigkeiten“ im Menü). Bei jedem Release `version` anheben und einen Eintrag ergänzen.
- **Umgebungen:** Jeder Push (beliebiger Branch) deployt nach <https://dev.td.rennecke.org>; Pushes auf `main` werden
  anschließend – nach erfolgreichem Dev-Deployment – nach <https://td.rennecke.org> ausgeliefert.
- **Rolling Deployment:** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) baut einmal (Typecheck, Tests, Build, LAN-Paket)
  und lädt das Release nach `~/lan-td[-dev]/releases/<id>`. [`tools/deploy-remote.sh`](tools/deploy-remote.sh) startet es als neue
  Instanz neben der alten; ein kleiner Router ([`server/router.ts`](server/router.ts)) auf dem öffentlichen Port schickt neue
  Besucher und neue Räume zur neuen Version, bestehende Räume bleiben auf ihrer (alten) Instanz, bis sie leer sind – laufende Spiele
  werden nicht unterbrochen. Leere alte Instanzen räumt das nächste Deployment auf. Es gibt 4 Slots; sind alle noch durch laufende Räume belegt, bricht das Deployment ab.
  Spielstände und Rekorde liegen in `~/lan-td-data` bzw. `~/lan-td-dev-data` und bleiben erhalten.
- Nach der Umstellung läuft Prod/Dev als `lan-td-router` + `lan-td-s0…s3` (supervisord). Das allererste Rolling-Deployment ersetzt den alten
  Einzel-Dienst `lan-td` und unterbricht dabei einmalig.
- Grenze: Ändert sich das Netzwerkprotokoll zwischen Versionen, sollten laufende Räume vor einem Reload der Seite zu Ende gespielt werden
  (ein neu geladener Client spricht die neue Version, der Raum läuft noch auf der alten).

Einmalige Einrichtung:

1. **DNS:** Für `td.rennecke.org` **und** `dev.td.rennecke.org` einen `A`/`AAAA`-Eintrag (oder `CNAME`) auf den Uberspace-Host setzen.
2. Auf dem Uberspace (per SSH): `uberspace tools version use node 22` (die Domains legt der Workflow per `uberspace web domain add` an).
3. **GitHub → Settings → Secrets and variables → Actions → Secrets:** `SFTP_HOST`, `SFTP_USERNAME`,
   `SFTP_PRIVATE_KEY` (ein SSH-Schlüssel nur für dieses Deployment; der öffentliche Schlüssel muss in `~/.ssh/authorized_keys` stehen).
   Optional als *Variables*: `TD_REMOTE_ROOT` (`lan-td`), `TD_PORT` (`61235`), `TD_DOMAIN` (`td.rennecke.org`), `TD_EXTRA_DOMAIN` (`paul-rennecke.de`,
   dort läuft das Spiel zusätzlich unter `/td/`; die Domain muss auf demselben Uberspace-Account liegen) sowie
   `TD_DEV_REMOTE_ROOT` (`lan-td-dev`), `TD_DEV_PORT` (`61245`), `TD_DEV_DOMAIN` (`dev.td.rennecke.org`). Je Umgebung werden
   der Router-Port und die 4 folgenden Ports belegt.
4. Workflow per Push oder manuell („Run workflow“) starten.

Nützlich auf dem Server: `supervisorctl status`, `supervisorctl tail -f lan-td-s0 stderr`, `cat ~/lan-td-data/router.json`.

## Lizenz und Hinweise

- Der Quellcode steht unter der [MIT-Lizenz](LICENSE).
- **Fan-Projekt:** LAN TD ist ein unabhängiges, nicht-kommerzielles Hobbyprojekt, das vom Spielprinzip der Warcraft-III-Karte
  „Wintermaul TD“ inspiriert ist. Es enthält keine Original-Assets, -Texturen, -Modelle oder -Sounds; alle Grafiken werden im
  Code erzeugt. Einzelne Namen (z. B. Kartenname, Klassen- und Einheitennamen sowie die Zufallsnamen der Spieler) lehnen sich an
  das Warcraft-Universum an. „Warcraft“ und „Blizzard“ sind Marken von Blizzard Entertainment, Inc.; das Projekt steht in keiner
  Verbindung zu Blizzard Entertainment und wird von dort nicht unterstützt.
- Der öffentliche Server ist ein privates Angebot ohne Gewähr. Es werden keine Konten oder personenbezogenen Daten gespeichert;
  Spielernamen und Spielstände liegen nur als Dateien auf dem Server (Spielstände je Browser-Schlüssel).
