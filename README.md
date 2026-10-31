# ⚔ Schlacht um Azeroth – LAN Tower Defense

Kooperatives 3D-Tower-Defense im Browser für **bis zu 16 Spieler im lokalen Netzwerk**, inspiriert von den
Tower-Defense-Mods aus Warcraft 3 (Element TD, Legion TD, Wintermaul …).

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

1. **Lobby:** Namen eingeben, eine von 6 Klassen wählen, „Bereit“ klicken. Der Host (👑) startet das Spiel.
2. Die Karte hat einen langen, gewundenen Pfad. Er ist in **16 Bauabschnitte** aufgeteilt, die reihum an die Spieler
   verteilt werden (jeder bekommt frühe und späte Stücke des Pfads). Eigene Abschnitte sind in deiner Farbe markiert.
3. **40 Wellen** mit immer stärkeren Gegnern – alle 10 Wellen ein **Boss**. Danach geht es im **Endlos-Modus**
   weiter; der Rekord (erreichte Welle) wird gespeichert.
4. Durchgelassene Gegner kosten **gemeinsame Leben** (50). Bei 0 ist das Spiel für alle verloren.

### Wirtschaft

- **Gold** ist pro Spieler. Jeder Kill bringt **allen** Spielern Gold (Teamplay statt Kill-Stealing).
- Zu Beginn jeder Welle gibt es Einkommen (+ Goblin-Bank/Investitionen) und **Holz**.
- **Holz** braucht man für Forschung und die Ultimate-Türme. Besiegte Bosse geben +2 Holz für alle.
- Verkaufen erstattet 75 % der Investition.

### Kampfsystem (wie WC3)

Angriffstypen (Normal, Durchbohren, Belagerung, Magie, Chaos) gegen Rüstungstypen (Ungerüstet, Leicht, Mittel,
Schwer, Befestigt, Held) – die Tabelle steht in der Lobby. Dazu kommen Rüstungswerte nach der WC3-Formel und
Spezialgegner:

| Gegner-Eigenschaft | Was hilft |
|---|---|
| **Luft** | Türme mit Ziel „Luft“ (z. B. Greifenhorst, Windreiter, Hippogreifen) |
| **Unsichtbar** | Türme mit **Erkennung** in der Nähe (Arkaner Turm, Schamane, Obsidianstatue, Mondbrunnen, Dryadenhain, Luftturm, Teslaspule) |
| **Magieimmun** | Kein Magie-Schaden, keine Slows/Betäubungen – Belagerung/Chaos benutzen |
| **Heiler / Regeneration** | Schaden bündeln, Fokus „Stärkster“ |
| **Teilt sich** | Flächenschaden |

### Klassen

| Klasse | Stil | Türme |
|---|---|---|
| 🛡️ **Allianz** | Allrounder | Wachturm, Kanonenturm, Arkaner Turm, Kirche (Tempo-Aura), Greifenhorst, *Erzmagierturm* |
| 🪓 **Horde** | Rohe Gewalt | Speerwerfer, Katapult, Kriegstrommel (Schadens-Aura), Schamanenturm, Windreiter-Horst, *Festung des Häuptlings* |
| ☠️ **Geißel** | Debuffs | Geisterturm, Seuchenturm, Frostturm, Fleischwagen, Obsidianstatue, *Frostthron* |
| 🌙 **Nachtelfen** | Natur & Auren | Uralter Schütze, Mondbrunnen, Dornenranke, Dryadenhain, Hippogreifen-Nest, *Weltenbaum* |
| 🔥 **Elementarist** | Element TD | Feuer, Wasser, Erde, Luft, *Magmaturm (Fusion)*, *Elementarvortex* |
| ⚙️ **Goblin-Ingenieure** | Technik & Profit | Maschinengewehr, Raketenturm, Teslaspule, Minenleger, Goblin-Bank, *Zeppelin-Werft* |

Jeder Turm hat **3 Stufen**. Jede Klasse hat **4 Forschungen** (globale Boni und die Freischaltung des Ultimate-Turms).

### Steuerung

| Taste | Aktion |
|---|---|
| **1–6** | Turm zum Bauen wählen |
| **Linksklick** | Bauen / Auswählen (**Shift** gedrückt = mehrere bauen) |
| **Rechtsklick / Esc** | Bauen abbrechen / Auswahl aufheben |
| **U** / **V** | Ausgewählten Turm aufwerten / verkaufen |
| **F** | Forschung |
| **N** | Bereit für die nächste Welle (wenn alle bereit sind, startet sie in 3 s) |
| **Pfeiltasten**, Bildschirmrand, **rechte/mittlere Maustaste ziehen** | Kamera bewegen |
| **Mausrad** | Zoomen |
| **Leertaste** | Zu eigenen Abschnitten springen |
| **Alt + Klick** | Ping auf der Karte für alle |
| **Enter** | Chat |
| **Tab** (halten) | Punktestand |
| **P** / ⏸ | Spiel pausieren / fortsetzen (jeder Spieler) |
| 💾 | Spiel speichern |

Klick auf die Minimap bewegt die Kamera. Bei ausgewählten Türmen lässt sich die Zielwahl einstellen
(Vorderster, Hinterster, Stärkster, Schwächster, Nächster).

### Pause, Speichern & Laden

- **Pause:** Jeder Spieler kann das Spiel mit **P** oder ⏸ anhalten und fortsetzen. Während der Pause stehen
  Gegner und Countdown still; Bauen, Aufwerten, Verkaufen und Forschung sind gesperrt.
- **Speichern:** Mit 💾 jederzeit während des Spiels. Die Spielstände liegen auf dem Server-Rechner im Ordner
  `saves/` (gleicher Name überschreibt den alten Spielstand).
- **Laden:** Der Host 👑 lädt einen Spielstand in der Lobby (Liste „💾 Spielstände“). Spieler übernehmen den
  Platz mit **gleichem Namen**, die übrigen Plätze werden der Reihe nach vergeben. Klassen kommen aus dem Spielstand.
  Unbesetzte Plätze übernehmen später beitretende Spieler automatisch. Ein geladenes Spiel startet pausiert.

### Verbindung & Zuschauer

- Bei einem Verbindungsabbruch (oder Neuladen im selben Tab) verbindet sich der Client automatisch neu und übernimmt
  wieder seinen Spieler – Türme und Gold bleiben erhalten.
- Wer einem laufenden Spiel beitritt (oder Spieler 17+), schaut zu und ist in der nächsten Runde dabei.

## Technik

```
shared/   Spieldaten & Regeln (Klassen, Türme, Gegner, Wellen, Karte, Schadenstabelle, Protokoll)
server/   Node.js-Server: HTTP für den Client + WebSocket, Lobby, autoritative Simulation (20 Ticks/s)
client/   Browser-Client: Vite + Three.js, prozedurale Low-Poly-Modelle, HUD
tools/    Bots, Balancing-Simulation, Browser-Tests
tests/    Vitest (Regeln, Simulation, Server-Protokoll)
```

- Der **Server ist autoritativ**: Clients schicken nur Befehle (bauen, aufwerten, …). Der Server sendet 10× pro
  Sekunde einen kompakten Snapshot (Gegner nur als Position auf dem Pfad), die Clients interpolieren dazwischen.
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
