# ❄ Wintermaul TD – LAN Tower Defense

Kooperatives 3D-Maze-Tower-Defense im Browser für **bis zu 16 Spieler im lokalen Netzwerk**, nachempfunden der
Warcraft-III-Karte **Wintermaul TD**: verschneite Karte, Gegner aus mehreren Portalen im Norden, ein Tor im Süden –
und kein fester Weg, sondern **Labyrinthe (Mazes)**, die die Spieler selbst bauen.

Ein Rechner startet den Server, alle anderen öffnen einfach die angezeigte Adresse im Browser – keine Installation
auf den Mitspieler-Rechnern nötig.

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
netsh advfirewall firewall add rule name="LAN Tower Defense" dir=in action=allow protocol=TCP localport=3000
```

## Spielablauf

1. **Lobby:** Namen eingeben, eine von 6 Klassen wählen, „Bereit“ klicken. Der Host (👑) wählt die **Karte** und startet das Spiel.
   Außerdem legt der Host die **Spieloptionen** fest:
   - **Nur in eigenen Bauzonen bauen** (Standard an) – ausgeschaltet darf jeder in allen Bauzonen bauen,
     auch in Zonen ohne Besitzer.
   - **Laufweg der Gegner anzeigen** (Standard an) – ausgeschaltet gibt es keine rote Wegvorschau und keine
     Weglängen-Anzeige (für erfahrene Spieler).
2. **Karten** (Northrend-Look: verschneite Plateaus mit Felskanten, Eispfade, zugefrorenes Wasser):
   - **Wintermaul X9** – die klassische Karte: drei Portale im Norden, darunter ein breites Mittelfeld mit
     Eiskanälen, der große Felsgraben (∩) zwingt die Gegner links oder rechts herum, das Tor liegt im See im Süden.
   - **Nordend (4 Spuren)** – vier getrennte Spuren zwischen Eisklippen, unten ein gemeinsamer Trichter zum Tor.
   - **Zwillingsgletscher** – zwei Spuren biegen nach innen ab und vereinen sich zu einer Schlucht nach Süden.

   Jede Karte hat **16 Bauzonen**. Je nach Spielerzahl sind 1–4 Portale aktiv (z. B. X9: 1 Spieler = Mitte,
   2 Spieler = links/rechts, ab 3 alle drei). Jedes aktive Portal schickt die **komplette Welle**; die Lebenspunkte
   skalieren mit der Spielerzahl pro Spur. Zonen inaktiver Spuren bleiben leer, gemeinsame Zonen (z. B. der untere
   Teil von X9) werden immer verteilt.
3. **Mazing:** Es gibt keinen festen Pfad. Bodengegner laufen immer den kürzesten Weg um die Türme herum. Mit billigen
   **Mauerblöcken** (5 Gold, Taste 1) baut man Wände mit Lücken, sodass die Gegner Schlangenlinien laufen müssen.
   - Die **rote gestrichelte Linie** zeigt den aktuellen Weg, im Baumenü steht die **Weglänge** je Spur.
   - Den Weg komplett zu **blockieren** ist nicht erlaubt (das Bau-Feld wird rot). Auch auf Gegnern kann man nicht bauen.
   - **Flieger** ignorieren das Labyrinth und fliegen direkt zum Tor.
4. **40 Wellen** mit immer stärkeren Gegnern – alle 10 Wellen ein **Boss**. Danach geht es im **Endlos-Modus**
   weiter; der Rekord (erreichte Welle) wird gespeichert.
5. Durchgelassene Gegner kosten **gemeinsame Leben** (50, +10 je weiterer aktiver Spur). Bei 0 ist das Spiel verloren.

### Wirtschaft

- **Gold** ist pro Spieler (Start: 450). Kills bringen allen Verteidigern der jeweiligen Spur Gold – hilft ein Turm
  aus einer anderen Spur aus, bekommt dessen Besitzer das Kopfgeld ebenfalls.
- Zu Beginn jeder Welle gibt es Einkommen (+ Goblin-Bank/Investitionen) und **Holz**.
- **Holz** braucht man für Forschung und die Ultimate-Türme. Besiegte Bosse geben den Verteidigern ihrer Spur +2 Holz.
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
| **Linksklick** | Bauen / Auswählen (**Shift** gedrückt = mehrere bauen) |
| **Rechtsklick / Esc** | Bauen abbrechen / Auswahl aufheben |
| **U** / **V** | Ausgewählten Turm aufwerten / verkaufen |
| **F** | Forschung |
| **N** | Bereit für die nächste Welle (wenn alle bereit sind, startet sie in 3 s) |
| **Pfeiltasten**, Bildschirmrand, **rechte/mittlere Maustaste ziehen** | Kamera bewegen |
| **Mausrad** | Zoomen |
| **Leertaste** | Zu eigenen Bauzonen springen |
| **Alt + Klick** | Ping auf der Karte für alle |
| **Enter** | Chat |
| **Tab** (halten) | Punktestand |
| **F10** / ☰ Menü (unten rechts) | Menü: Pause, Speichern, Punktestand, **Laufweg an/aus**, **Bauzonen-Linien an/aus**, Ton, Spiel beenden (Anzeige-Schalter gelten nur für den eigenen Bildschirm und werden gemerkt) |
| **P** | Spiel pausieren / fortsetzen (jeder Spieler) |
| Menü → 💾 | Spiel speichern |
| Menü → 🚪 | Spiel beenden (nur Host) – fragt: speichern, nicht speichern oder abbrechen; danach sind alle wieder in der Lobby |

Klick auf die Minimap bewegt die Kamera. Bei ausgewählten Türmen lässt sich die Zielwahl einstellen
(Vorderster, Hinterster, Stärkster, Schwächster, Nächster).

### Pause, Speichern & Laden

- **Pause:** Jeder Spieler kann das Spiel mit **P** oder ⏸ anhalten und fortsetzen. Während der Pause stehen
  Gegner und Countdown still; Bauen, Aufwerten, Verkaufen und Forschung sind gesperrt.
- **Speichern:** Mit 💾 jederzeit während des Spiels. Die Spielstände liegen auf dem Server-Rechner im Ordner
  `saves/` (gleicher Name überschreibt den alten Spielstand).
- **Laden:** Der Host 👑 lädt einen Spielstand (inkl. Karte) in der Lobby (Liste „💾 Spielstände“). Spieler übernehmen den
  Platz mit **gleichem Namen**, die übrigen Plätze werden der Reihe nach vergeben. Klassen kommen aus dem Spielstand.
  Unbesetzte Plätze übernehmen später beitretende Spieler automatisch. Ein geladenes Spiel startet pausiert.

### Verbindung & Zuschauer

- Bei einem Verbindungsabbruch (oder Neuladen im selben Tab) verbindet sich der Client automatisch neu und übernimmt
  wieder seinen Spieler – Türme und Gold bleiben erhalten.
- Wer einem laufenden Spiel beitritt (oder Spieler 17+), schaut zu und ist in der nächsten Runde dabei.

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
npm run dev:client       # Vite-Dev-Server mit Hot-Reload (leitet /ws an Port 3000 weiter)
npm test                 # Unit- und Integrationstests
npm run typecheck        # TypeScript prüfen
npm run bots -- 15 --start     # 15 Bot-Spieler verbinden sich (Lasttest / Lobby füllen)
npm run balance -- 4 45        # Headless-Balancing: 4 Bot-Spieler bis Welle 45
```

Optionale Browser-Tests (benötigen `playwright-core` und Edge):
`npx tsx tools/e2e.ts <pfad-zu-playwright-core>` und `npx tsx tools/spectate.ts <pfad-zu-playwright-core>`.
