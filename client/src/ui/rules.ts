import { ENEMIES } from '../../../shared/data/enemies';
import {
  BOUNTY_SHARE, START_GOLD, START_LIVES, START_LUMBER, VICTORY_WAVE, WAVE_COUNTDOWN, waveBounty, waveIncome, waveLumber,
} from '../../../shared/data/waves';
import { damageTableHtml, esc } from './format';

const pct = (n: number) => `${Math.round(n * 100)} %`;

/** The complete rules as HTML (without a heading). Used in the in-game overlay and, collapsed, in the lobby. */
export function rulesHtml(): string {
  const waves = [1, 5, 10, 20, 30, 40].map((n) => `<tr><td>Welle ${n}</td><td class="num">${waveIncome(n)} 💰</td><td class="num">${waveBounty(n)} 💰</td><td class="num">${waveLumber(n)} 🌲</td></tr>`).join('');
  const enemies = ENEMIES.map((d) => `<tr><td>${esc(d.name)}${d.boss ? ' 👑' : ''}</td><td class="num">${d.lives}</td><td class="num">${d.bounty}×</td><td>${[d.flying ? 'fliegt' : '', d.invisible ? 'unsichtbar' : '', d.immune ? 'magieimmun' : '', d.regen ? 'regeneriert' : '', d.heal ? 'heilt andere' : '', d.split ? 'teilt sich' : ''].filter(Boolean).join(', ') || '–'}</td></tr>`).join('');
  return `
      <h3>Ziel</h3>
      <p>Alle Spieler verteidigen gemeinsam ein Tor gegen immer stärkere Wellen. Überstehst du Welle <b>${VICTORY_WAVE}</b>, ist das Spiel gewonnen und der <b>Endlos-Modus</b> beginnt – dort zählt nur noch, wie weit ihr kommt. Pro Karte wird die beste erreichte Welle als Rekord gespeichert. Fällt das gemeinsame Leben auf 0, ist das Spiel verloren.</p>
      <h3>So läuft eine Runde</h3>
      <ul>
        <li>Gegner starten an den <b>Portalen</b> (je nach Spielerzahl sind mehrere Spuren aktiv) und laufen zum <b>Tor</b>. Jeder durchgekommene Gegner kostet gemeinsame Leben.</li>
        <li>Alle Spieler bauen mit ihrer <b>Klasse</b> Türme – überall auf der Karte, wo gebaut werden darf. Sprecht euch ab, wer wo verteidigt; in der Lobby setzt ihr dazu euer ✖ auf die Kartenvorschau. Die Türme einer Klasse unterscheiden sich in Reichweite, Schaden, Angriffstyp und Spezialfähigkeiten.</li>
        <li><b>Labyrinth:</b> Gegner laufen immer den kürzesten freien Weg um eure Türme herum. Baut Mauern und Türme so, dass der Weg möglichst lang wird (die rote Linie zeigt ihn). Den Weg komplett zu versperren ist nicht erlaubt. Flieger ignorieren Türme, müssen aber um Felsen herum.</li>
        <li><b>Welle 1</b> startet erst, wenn alle Spieler auf „Bereit“ gedrückt haben. Danach beginnt der Countdown zur nächsten Welle (${WAVE_COUNTDOWN} s) erst, wenn der letzte Gegner der Welle besiegt ist; sind alle bereit, geht es nach 3 s los.</li>
        <li>Türme lassen sich bis <b>Stufe 3</b> aufwerten. Mit <b>Forschung</b> (Gold und Holz) verbessert ihr alle Türme der Klasse und schaltet den stärksten Turm frei.</li>
        <li>Gold lässt sich an Mitspieler <b>verschenken</b>. Wer die Verbindung verliert, dessen Türme gehören allen gemeinsam. Neue Spieler können später einsteigen.</li>
        <li>Achtung: <b>Luft</b>-Wellen (nur Türme mit Luftzielen treffen), <b>unsichtbare</b> Gegner (brauchen einen Turm mit Erkennung) und <b>Magieimmune</b> (kein Magieschaden).</li>
      </ul>
      <h3>Steuerung</h3>
      <ul>
        <li><b>Bauen:</b> Taste <kbd>1</kbd>–<kbd>7</kbd> oder Button, Maus oder Pfeiltasten bewegen den Cursor, Klick / <kbd>Enter</kbd> / <kbd>Leertaste</kbd> baut (<kbd>Shift</kbd> = mehrere). Der Turmtyp bleibt gewählt, <kbd>Esc</kbd> beendet das Bauen.</li>
        <li><b>Auswählen:</b> Klick, Pfeiltasten (Turm unter dem Cursor), <kbd>Q</kbd>/<kbd>E</kbd> oder mit der Maus einen Auswahlrahmen aufziehen. Dann <kbd>U</kbd> aufwerten, <kbd>V</kbd>/<kbd>Entf</kbd> verkaufen, <kbd>C</kbd> Zielmodus wechseln.</li>
        <li><b>Kamera:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, Bildschirmrand, rechte Maustaste ziehen, Mausrad zoomt, <kbd>Leertaste</kbd> springt zu Portalen und Tor.</li>
        <li><kbd>F</kbd> Forschung · <kbd>N</kbd> bereit für die nächste Welle · <kbd>P</kbd> Pause · <kbd>Strg</kbd>+<kbd>S</kbd> speichern · <kbd>R</kbd> Laufweg · <kbd>G</kbd> Raster · <kbd>T</kbd> Gold senden · <kbd>M</kbd> Ton · <kbd>B</kbd>/<kbd>Tab</kbd> Punktestand · <kbd>Enter</kbd> Chat · <kbd>Alt</kbd>+Klick Ping · <kbd>F10</kbd> Menü · <kbd>Shift</kbd>+<kbd>Q</kbd> Spiel beenden (Host).</li>
      </ul>
      <h3>Gold, Holz und Leben – genaue Zahlen</h3>
      <ul>
        <li><b>Start:</b> ${START_GOLD} Gold, ${START_LUMBER} Holz pro Spieler; ${START_LIVES} gemeinsame Leben (+10 für jede weitere aktive Spur).</li>
        <li><b>Wellengeld:</b> Zu Beginn jeder Welle bekommt <u>jeder</u> Spieler <b>25 + 5 × Wellennummer</b> Gold (Forschung „Investitionen“ gibt zusätzlich +15 je Stufe) und <b>1 Holz</b> (Boss-Wellen: 2).</li>
        <li><b>Kopfgeld:</b> Für jeden besiegten Gegner gibt es einen Topf von <b>(2 + ⌊Welle ÷ 3⌋) × Faktor des Gegners</b> Gold (gerundet, mindestens 1) × Spielerzahl ÷ aktive Spuren (jede Spur schickt die ganze Welle; so hängt das Einkommen des Teams nicht von der Spurzahl ab). Den Topf bekommt nur, wer <u>etwas dazu beigetragen</u> hat:
          <ul>
            <li><b>${pct(BOUNTY_SHARE.damage)} nach Schaden:</b> im Verhältnis zum Schaden, den jeder Spieler (mit Türmen, Gift, Minen …) an diesem Gegner verursacht hat. Überschüssiger Schaden beim Todesstoß zählt nicht.</li>
            <li><b>${pct(BOUNTY_SHARE.control)} nach Kontrolle:</b> im Verhältnis zur Zeit, die ein Spieler den Gegner <b>verlangsamt</b>, <b>betäubt</b> oder seine <b>Rüstung gesenkt</b> hat (stärkere Effekte zählen mehr, ein bloßes Erneuern eines laufenden Effekts nur um die verlängerte Zeit). Setzt niemand Kontrolle ein, fällt dieser Teil an den Schadensanteil.</li>
            <li><b>${pct(BOUNTY_SHARE.kill)} für den Todesstoß:</b> der Spieler, dessen Turm den Gegner besiegt.</li>
          </ul>
          Wer nichts beigetragen hat, bekommt nichts. Gegner, die das Tor erreichen, zahlen kein Kopfgeld. Der Todesstoß-Spieler erhält zusätzlich den Bonus der Forschung „Plündern“ (+1 Gold je Stufe). Die kleine Zahl über dem Gegner zeigt deinen eigenen Anteil.</li>
        <li><b>Bosse:</b> Wird ein Boss besiegt, bekommen alle Spieler +2 Holz.</li>
        <li><b>Verkaufen:</b> Du erhältst <b>75 %</b> des insgesamt in den Turm investierten Golds (Bau + Aufwertungen) zurück.</li>
        <li><b>Leben:</b> Ein durchgekommener Gegner kostet so viele Leben, wie in der Tabelle unten steht.</li>
      </ul>
      <table><tr><th>Zeitpunkt</th><th class="num">Wellengeld pro Spieler</th><th class="num">Kopfgeld (Faktor 1×, je Gegner)</th><th class="num">Holz</th></tr>${waves}</table>
      <table><tr><th>Gegner</th><th class="num">Leben bei Durchbruch</th><th class="num">Kopfgeld-Faktor</th><th>Besonderheiten</th></tr>${enemies}</table>
      <h3>Schadenstabelle</h3>
      ${damageTableHtml()}`;
}
