/* raumo views: the front page (the buildings you scanned), the help page and the small "nothing here" pages. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const Store = window.RaumoStore;
  const R = (window.Raumo = window.Raumo || {});
  const { h, put, fill, icon, logo, menu, num, area, dateText } = R;

  const brand = () => h("a", { class: "brand", href: "#/", "aria-label": "raumo, zur Übersicht" }, logo(), h("span", {}, "raumo"));
  const count = (n) => n.toLocaleString("de-DE");

  R.notFoundView = function notFoundView(app, text) {
    return h("div", { class: "empty" }, h("h3", {}, "Das gibt es nicht"), h("p", {}, text || "Diese Seite gibt es nicht."), h("a", { class: "btn primary", href: "#/" }, "Zur Übersicht"));
  };

  R.emptyScans = function emptyScans(app, project) {
    return h("div", { class: "empty" }, icon("points"), h("h3", {}, "Noch kein Scan"), h("p", {}, "Gehe durch den Raum und scanne ihn, miss einen Raum im Stehen oder öffne eine Punktwolke."),
      h("button", { class: "btn primary", type: "button", onclick: () => app.newRoom(project.id) }, icon("plus"), h("span", {}, "Scan hinzufügen")));
  };

  // ------------------------------------------------------------------------------------------------- home
  R.homeView = async function homeView(app) {
    const projects = await app.store.listProjects();
    const view = { dead: false, element: h("div", { class: "screen home" }), destroy() { view.dead = true; } };
    const header = h("header", { class: "bar home-bar" }, brand(), h("span", { class: "grow" }),
      h("a", { class: "icon-btn", href: "#/hilfe", "aria-label": "Hilfe" }, icon("help")));
    const main = h("main", { class: "home-main scroll", id: "main" });
    if (!app.store.persistent) put(main, h("div", { class: "notice warn" }, icon("warn"), h("span", {}, "Dein Browser erlaubt kein dauerhaftes Speichern (zum Beispiel in einem privaten Fenster). Deine Scans bleiben nur, bis du die Seite schließt. Speichere sie als Sicherung.")));

    if (!projects.length) {
      put(main, h("section", { class: "hero" },
        h("div", { class: "hero-logo" }, logo()),
        h("h1", {}, "Durch den Raum gehen. Scannen. Punkte ansehen."),
        h("p", { class: "lead" }, "Du gehst mit dem Handy durch ein Gebäude. raumo setzt etwa alle 5 cm einen Punkt in der Farbe, die die Kamera dort sieht, und zeigt dir die Punktwolke in 3D. Alles läuft in der Webseite, nichts wird hochgeladen."),
        h("div", { class: "hero-actions" },
          h("button", { class: "btn primary big", type: "button", onclick: () => app.newRoom(null) }, icon("scan"), h("span", {}, "Scannen")),
          h("button", { class: "btn ghost big", type: "button", onclick: () => app.walk("sim", null) }, icon("walk"), h("span", {}, "Übungsrundgang ausprobieren"))),
        h("ol", { class: "steps-list" },
          h("li", {}, h("b", {}, "Gehen"), h("span", {}, "Laufe langsam durch den Raum und richte das Handy auf Wände, Boden und Möbel.")),
          h("li", {}, h("b", {}, "Punkte entstehen"), h("span", {}, "Das Handy misst die Entfernung zu allem, was die Kamera sieht, und merkt sich Ort und Farbe.")),
          h("li", {}, h("b", {}, "Ansehen und mitnehmen"), h("span", {}, "Drehe die Wolke, geh hindurch, miss Abstände, speichere sie als PLY oder LAS."))),
        h("div", { class: "honest" }, icon("info"), h("div", {},
          h("p", {}, h("b", {}, "Auf welchen Handys geht das? "), "Das Durchlaufen-Scannen mit Tiefenmessung braucht, dass der Browser die Tiefe und die Position des Handys freigibt. Das tun Android-Handys mit Chrome (ARCore). Das iPhone erlaubt es Webseiten nicht. Dort kannst du einen Raum im Stehen messen (Ecken anzeigen, dabei entsteht auch eine Punktwolke) oder eine Punktwolke aus einer anderen Scan-App öffnen."),
          h("p", {}, "Die Genauigkeit liegt bei Handy-Tiefensensoren bei einigen Zentimetern, nicht bei Millimetern wie bei einem Laserscanner."))),
        h("div", { class: "hero-more" },
          h("button", { class: "btn ghost small", type: "button", onclick: () => app.openExample() }, "Beispielgebäude ansehen"),
          h("button", { class: "btn ghost small", type: "button", onclick: () => app.importCloud(null) }, icon("upload"), h("span", {}, "Punktwolke öffnen")),
          h("button", { class: "btn ghost small", type: "button", onclick: () => app.pickBackup() }, icon("upload"), h("span", {}, "Sicherung laden")))));
    } else {
      const list = h("ul", { class: "project-list" });
      for (const project of projects) {
        const t = R.totals(project);
        const thumb = project.thumb && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(project.thumb) ? h("img", { src: project.thumb, alt: "", loading: "lazy" }) : icon("points");
        const bits = [t.clouds + t.rooms === 1 ? "1 Scan" : `${t.clouds + t.rooms} Scans`, t.points ? `${count(t.points)} Punkte` : null, t.rooms ? area(t.area) : null].filter(Boolean);
        list.append(h("li", { class: "project-card" },
          h("a", { class: "pc-main", href: `#/p/${project.id}` }, h("span", { class: "pc-thumb" }, thumb),
            h("span", { class: "pc-text" }, h("b", {}, project.name), h("small", {}, bits.join(" · ")), h("small", { class: "muted" }, dateText(project.updated)))),
          h("button", { class: "icon-btn", type: "button", "aria-label": `Mehr zu ${project.name}`, onclick: (e) => menu(e.currentTarget, [
            { label: "Öffnen", icon: "cube", run: () => app.go(`/p/${project.id}`) },
            { label: "Umbenennen", icon: "edit", run: () => app.renameProject(project) },
            { label: "Sicherung speichern", icon: "download", run: () => app.saveBackup(project) },
            { label: "Löschen", icon: "trash", danger: true, run: () => app.deleteProject(project) },
          ]) }, icon("more"))));
      }
      put(main, h("h1", { class: "section-title" }, "Deine Gebäude"), list,
        h("div", { class: "home-actions" },
          h("button", { class: "btn ghost small", type: "button", onclick: () => app.openExample() }, "Beispielgebäude"),
          h("button", { class: "btn ghost small", type: "button", onclick: () => app.importCloud(null) }, icon("upload"), h("span", {}, "Punktwolke öffnen")),
          h("button", { class: "btn ghost small", type: "button", onclick: () => app.pickBackup() }, icon("upload"), h("span", {}, "Sicherung laden"))));
    }
    put(main, h("footer", { class: "foot" }, h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"), h("a", { href: "#/hilfe" }, "Hilfe"), h("span", {}, "raumo")));
    put(view.element, header, main);
    if (projects.length) put(view.element, h("button", { class: "fab", type: "button", onclick: () => app.newRoom(null) }, icon("plus"), h("span", {}, "Neuer Scan")));
    return view;
  };

  // ------------------------------------------------------------------------------------------------- help
  R.helpView = function helpView(app) {
    const view = { dead: false, element: h("div", { class: "screen help" }), destroy() { view.dead = true; } };
    const section = (title, ...children) => h("section", { class: "card" }, h("h2", {}, title), ...children);
    put(view.element,
      h("header", { class: "bar" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück", onclick: () => (history.length > 1 ? history.back() : app.go("/")) }, icon("back")), h("h1", { class: "title" }, "Hilfe"), h("span", { class: "grow" })),
      h("main", { class: "scroll help-main", id: "main" },
        section("Durch den Raum gehen (Android)",
          h("ol", { class: "plain-steps" },
            h("li", {}, "Öffne raumo in Chrome auf einem Android-Handy mit ARCore und tippe auf „Scannen“, dann auf „Durch den Raum gehen“."),
            h("li", {}, "Erlaube Kamera und Bewegung. Das Handy zeigt das Kamerabild, die gefundenen Punkte erscheinen darauf."),
            h("li", {}, "Gehe langsam und halte 0,5 bis 4 Meter Abstand zu den Flächen. Schwenke das Handy über Wände, Boden, Decke und Möbel."),
            h("li", {}, "Tippe auf „Fertig“. Die Wolke wird gespeichert und in 3D gezeigt."))),
        section("Im Stehen messen (jedes Handy)",
          h("p", {}, "Wenn dein Handy keine Tiefe liefert (zum Beispiel ein iPhone), kannst du einen Raum von einer Stelle aus messen. Du zeigst mit dem Fadenkreuz auf die Ecken am Boden, die App berechnet aus den Winkeln den Grundriss, baut den Raum und legt die Fotos auf die Wände. Daraus entsteht auch eine Punktwolke, alle 5 cm ein Punkt, aber nur auf Wänden, Boden und Decke (Möbel sind nur als Bild auf den Flächen zu sehen)."),
          h("p", {}, "Miss eine Wand mit dem Zollstock nach und gib sie bei „Nachmessen“ ein: Dann stimmen alle Maße meist auf etwa 2 Prozent.")),
        section("Punktwolken aus anderen Apps",
          h("p", {}, "Du kannst Punktwolken aus anderen Scan-Apps öffnen (PLY, LAS oder XYZ), zum Beispiel vom iPhone mit LiDAR (Polycam, Scaniverse und andere exportieren PLY oder LAS). Auf „Punktwolke öffnen“ tippen und die Datei wählen. LAZ-Dateien werden nicht gelesen, speichere sie als LAS.")),
        section("Wie genau ist das?",
          h("p", {}, "Die Tiefensensoren in Handys haben Fehler von einigen Zentimetern, die mit der Entfernung wachsen. Darum zählt raumo nur Punkte, die mehrfach gesehen wurden, und mittelt sie. Für Maßnehmen auf den Millimeter brauchst du einen Laserscanner."),
          h("p", {}, "Mit dem Messwerkzeug (Lineal im 3D-Bild) misst du Abstände zwischen zwei Punkten.")),
        section("Probleme",
          h("ul", { class: "plain-steps" },
            h("li", {}, h("b", {}, "„Das geht auf diesem Gerät nicht“: "), "Dein Browser gibt keine Tiefenmessung frei. Probiere Chrome auf einem Android-Handy mit ARCore, oder miss den Raum im Stehen."),
            h("li", {}, h("b", {}, "Die Farben passen nicht zu den Punkten: "), "Das kommt auf manchen Geräten vor. Die Punkte sind dann nach Höhe gefärbt. Die Geometrie stimmt trotzdem."),
            h("li", {}, h("b", {}, "Die Kamera startet nicht: "), "Erlaube den Zugriff in den Einstellungen deines Browsers für diese Seite. Die Seite muss über https geöffnet sein."),
            h("li", {}, h("b", {}, "Scans weg? "), "Alles liegt nur in diesem Browser. Wenn du die Browserdaten löschst, ist es weg. Speichere wichtige Gebäude als Sicherung (.raumo) oder als PLY/LAS."))),
        section("Datenschutz",
          h("p", {}, "Die Kamerabilder, die Sensorwerte und deine Scans bleiben auf deinem Gerät. raumo lädt nichts hoch und hat kein Konto. Mehr in der ", h("a", { href: "/datenschutz" }, "Datenschutzerklärung"), "."))));
    return view;
  };
})();
