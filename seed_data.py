"""Single source of truth for Cheaper's curated, real (web-researched) offers.

seed_offers() is idempotent (every insert is guarded by an existence check)
and is called automatically from app.py's startup block, so every deploy --
i.e. every `git push` to master, which Railway rebuilds and restarts --
re-applies this same data to the production database. That's what keeps the
live web app and the desktop app (a thin wrapper around that same live site,
see cheaper-desktop/src/main.js) in sync with whatever offers exist here,
without a separate manual seeding step per deploy.

Can still be run standalone for local dev: .venv/Scripts/python.exe seed_data.py
"""
from models import db, User, Offer, DiscountCode

# Only Mathäser has an actual company account (created via the real UI
# flow); every other entry below is admin-seeded (company_id=None), matching
# how Offer's own docstring describes example/reference listings.
MATHAESER = {
    "username": "mathaeser_kino", "password": "secret123",
    "company_name": "Mathäser Filmpalast", "company_address": "Bayerstraße 3, 80335 München",
}

MATHAESER_OFFERS = [
    dict(provider_name="Mathäser Filmpalast", title="Komfort-Sessel", category="unterhaltung", city="München",
         link_url="https://www.mathaeser.de/", normal_price_cents=899, discount_price_cents=649,
         discount_max_age=14, discount_label="Kinder bis 14 Jahre",
         description="Kinoticket auf einem Komfort-Sessel im Mathäser Filmpalast München."),
    dict(provider_name="Mathäser Filmpalast", title="Premium-Sessel", category="unterhaltung", city="München",
         link_url="https://www.mathaeser.de/", normal_price_cents=1349, discount_price_cents=999,
         discount_max_age=14, discount_label="Kinder bis 14 Jahre",
         description="Kinoticket auf einem Premium-Sessel im Mathäser Filmpalast München."),
    dict(provider_name="Mathäser Filmpalast", title="D-Box-Bewegungssessel", category="unterhaltung", city="München",
         link_url="https://www.mathaeser.de/", normal_price_cents=1499, discount_price_cents=1149,
         discount_max_age=14, discount_label="Kinder bis 14 Jahre",
         description="Kinoticket auf einem D-Box-Bewegungssessel im Mathäser Filmpalast München."),
]

# provider_name, title, category, city, link_url, normal€, discount€ or None, max_age or None, label
REAL_OFFERS = [
    ("Deutsches Museum", "Tageskarte", "bildung", "München",
     "https://www.deutsches-museum.de/museumsinsel/besuch/preise-und-tickets",
     14.00, 8.00, 17, "Kinder & Jugendliche 6-17 Jahre"),
    ("Tierpark Hellabrunn", "Tageskarte", "bildung", "München",
     "https://www.hellabrunn.de/parkbesuch/allgemeine-informationen/tickets",
     20.00, 8.00, 14, "Kinder"),
    ("Zoo Berlin", "Tageskarte", "bildung", "Berlin",
     "https://www.zoo-berlin.de/de/tickets-service/tickets-preise",
     25.00, 12.50, 15, "Kinder"),
    ("Berliner Bäder-Betriebe", "Standardtarif Schwimmbad", "sport", "Berlin",
     "https://www.berlinerbaeder.de/preise-tarifsatzung/",
     5.50, 3.50, 17, "ermäßigt (u.a. Kinder/Jugendliche)"),
    ("Holthusenbad", "Tageskarte", "sport", "Hamburg",
     "https://www.baederland.de/baeder/alle-baeder/holthusenbad/",
     13.80, 9.70, 16, "Jugendliche 12-16 Jahre"),
    ("Parkbad Volksdorf", "Tageskarte", "sport", "Hamburg",
     "https://www.baederland.de/baeder/standorte/parkbad/",
     11.30, 5.50, 16, "Jugendliche 12-16 Jahre"),
    ("Festland", "Tageskarte", "sport", "Hamburg",
     "https://www.baederland.de/baeder/alle-baeder/festland/",
     11.70, 5.70, 16, "Jugendliche 12-16 Jahre"),
    ("Miniatur Wunderland", "Eintritt", "unterhaltung", "Hamburg",
     "https://www.miniatur-wunderland.com/visiting/plan-your-visit/admission-fees",
     22.00, 13.00, 15, "Kinder bis 15 Jahre"),
    ("Planetarium Hamburg", "Vorstellung", "bildung", "Hamburg",
     "https://www.planetarium-hamburg.de/de/besucherinformation",
     12.30, 7.70, 17, "ermäßigt (Schüler/Studierende)"),
    ("Kölner Zoo", "Tageskarte", "bildung", "Köln",
     "https://koelnerzoo.de/article/eintrittspreise/",
     27.00, 13.00, 12, "Kinder 4-12 Jahre (dynamische Preise, ca.)"),
    ("Zoo Frankfurt", "Tageskarte", "bildung", "Frankfurt",
     "https://www.zoo-frankfurt.de/de/zoobesuch-planen/eintrittskarten",
     12.00, 6.00, 17, "Kinder & Jugendliche 6-17 Jahre"),
    ("Wilhelma", "Tageskarte", "bildung", "Stuttgart",
     "https://www.wilhelma.de/en/visiting-us/information/entrance-fees",
     23.00, 9.00, 17, "Kinder ab 6 Jahren"),
    ("Zoo Leipzig", "Tageskarte", "bildung", "Leipzig",
     "https://www.zoo-leipzig.de/en/your-visit/prices-tickets/",
     26.00, 17.00, 16, "Kinder"),
    ("Zoo Dresden", "Tageskarte", "bildung", "Dresden",
     "https://www.zoo-dresden.de/besuch-planen/preise/",
     19.00, 10.00, 16, "Kinder"),
    ("LEGOLAND Deutschland", "Tageskarte", "freizeit", "Günzburg",
     "https://www.legoland.de/tickets/",
     64.00, 58.00, 11, "Kinder 2-11 Jahre (saisonale Preise, ca.)"),
    ("Phantasialand", "Tageskarte", "freizeit", "Brühl",
     "https://www.phantasialand.de/",
     66.00, 55.00, 11, "Kinder 4-11 Jahre (saisonale Preise, ca.)"),
    ("Europa-Park", "Tageskarte", "freizeit", "Rust",
     "https://www.europapark.de/en/theme-park/tickets-offers",
     72.00, 61.00, 11, "Kinder 4-11 Jahre (saisonale Preise, ca.)"),
    ("Movie Park Germany", "Tageskarte", "freizeit", "Bottrop",
     "https://www.movieparkgermany.de/",
     59.90, 54.90, 11, "Kinder 4-11 Jahre"),
]

# provider_name, title, category, link_url, normal€, discount€ or None, max_age or None, label or None
# -- all München, kept separate because every one of these is city-fixed.
MUNICH_OFFERS = [
    ("Pizziamo München", "Pizza Salami", "essen",
     "https://pizziamo089-bestellen.de/delivery", 13.00, None, None, None),
    ("Pizzeria Grano", "Pizza Margherita", "essen",
     "https://www.speisekarte.de/m%C3%BCnchen/restaurants/pizzeria", 6.90, None, None, None),
    ("L'Osteria München", "Pizza (Ø 40cm, zum Teilen)", "essen",
     "https://losteria.net/de/restaurants/restaurant/muenchen-kuenstlerhaus/", 11.90, None, None, None),
    ("Vapiano München", "Pasta", "essen",
     "https://all-menuprices.info/vapiano-speisekarte-preise/", 10.90, None, None, None),
    ("Hofbräuhaus München", "Hendl Bowl", "essen",
     "https://www.hofbraeuhaus.de/speisekarten/", 20.90, None, None, None),
    ("Hans Kebap", "Döner \"From Istanbul to Tokyo\"", "essen",
     "https://www.hanskebab.de/", 35.00, None, None, None),
    ("atoll München", "Bowling (1 Bahn/Stunde)", "freizeit",
     "https://atoll-muenchen.de/bowling-preise/", 19.00, None, None, None),
    ("Eis- und Funsportzentrum Ost", "Eintritt Eislaufen", "sport",
     "https://www.muenchen.de/freizeit/eislaufstadien/eis-und-funsportzentrum-ost",
     3.00, 2.00, 18, "Jugendliche bis 18 Jahre"),
]


# provider_name, title, category, district, link_url, normal€, discount€ or None, max_age or None, label
# -- real businesses/attractions specifically in the München-Nymphenburg
# and München-Pasing districts (city is always "München"; district is the
# finer-grained area shown on the card and used for the metro-area nearby
# matching in app.py's _metro_key).
DISTRICT_OFFERS = [
    ("Schloss Nymphenburg", "Schloss Tageskarte", "bildung", "Nymphenburg",
     "https://www.schloss-nymphenburg.de/deutsch/tourist/eintritt.htm",
     10.00, 0.00, 17, "Kinder & Jugendliche bis 18 Jahre frei"),
    ("Marstallmuseum & Porzellanmuseum Nymphenburg", "Tageskarte", "bildung", "Nymphenburg",
     "https://www.schloss-nymphenburg.de/deutsch/tourist/eintritt.htm",
     8.00, None, None, None),
    ("Botanischer Garten München-Nymphenburg", "Tageskarte", "bildung", "Nymphenburg",
     "https://botmuc-snsb.ticketfritz.de/",
     5.50, 0.00, 17, "Kinder & Jugendliche unter 18 Jahre frei"),
    ("L'Osteria München-Pasing", "Pizza (Ø 40cm, zum Teilen)", "essen", "Pasing",
     "https://losteria.net/de/restaurants/restaurant/muenchen-pasing/", 11.90, None, None, None),
    ("Westbad München", "Tageskarte Bad", "sport", "Pasing-Obermenzing",
     "https://www.swm.de/baeder/westbad-hallenbad",
     13.60, 8.70, 14, "Kinder & Jugendliche 6-14 Jahre"),
    ("Pasinger Fabrik", "Kinovorstellung", "unterhaltung", "Pasing",
     "https://pasinger-fabrik.de/film/",
     10.00, None, None, "Beispielpreis, variiert je Vorstellung"),
]

# brand_name, code (None if the real mechanism is "sign up and a code is
# emailed to you" rather than a fixed public code -- see seed_data.py's
# module docstring on why a fabricated code string is never used), description,
# image_url (real logo, sourced from Wikimedia Commons), link_url (the
# brand's own official page), category.
DISCOUNT_CODES = [
    ("Nike", None, "Rabattaktionen für Nike Member, u.a. Studierendenrabatt",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Logo_NIKE.svg/330px-Logo_NIKE.svg.png",
     "https://www.nike.com/de/aktions-code"),
    ("adidas", None, "Rabattgutscheine und Angebote für adiClub-Mitglieder",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Adidas_2022_logo.svg/330px-Adidas_2022_logo.svg.png",
     "https://www.adidas.de/adiclub"),
    ("H&M", None, "H&M Newsletter: exklusive Angebote, u.a. Studierendenrabatt über Student Beans",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/H%26M-Logo.svg/330px-H%26M-Logo.svg.png",
     "https://www2.hm.com/de_de/customer-service/newsletter.html"),
    ("Deichmann", None, "10% Rabatt ab 30€ Bestellwert (30 Tage gültig) bei Newsletter-Anmeldung",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Deichmann_logo.svg/330px-Deichmann_logo.svg.png",
     "https://www.deichmann.com"),
    ("Rossmann", None, "10%-Rabattcoupons in der ROSSMANN-App (digitale Wallet)",
     "https://upload.wikimedia.org/wikipedia/commons/8/8e/Rossmann_Logo.svg",
     "https://www.rossmann.de/de/service-und-hilfe/rossmann-app.html"),
    ("dm", None, "Rabattcode per E-Mail nach Newsletter-Anmeldung",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Dm-drogerie_markt_logo.svg/330px-Dm-drogerie_markt_logo.svg.png",
     "https://www.dm.de"),
    ("IKEA", None, "IKEA Family Mitgliedschaft: Sonderpreise, Newsletter-Rabatte, Geburtstagsgutschein",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Ikea_logo.svg/330px-Ikea_logo.svg.png",
     "https://www.ikea.com/de/de/ikea-family/"),
    ("Zalando", None, "Ca. 10% Rabatt auf die erste Bestellung nach Newsletter-Anmeldung",
     "https://upload.wikimedia.org/wikipedia/commons/0/0b/Zalando_logo.svg",
     "https://www.zalando.de"),
    ("Douglas", None, "Douglas Beauty Card: Rabattaktionen und Bonuspunkte für Mitglieder",
     "https://upload.wikimedia.org/wikipedia/commons/f/f4/Douglas_Logo_06.2018.svg",
     "https://www.douglas.de"),
    ("C&A", None, "Rabattaktionen für Newsletter-Abonnenten",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/C%26A_logo.svg/330px-C%26A_logo.svg.png",
     "https://www.c-and-a.com/de/de/shop/"),
    ("Saturn", None, "mySaturn Vorteilsprogramm: Punkte sammeln, 10€-Coupon ab 10.000 Punkten",
     "https://upload.wikimedia.org/wikipedia/commons/c/c3/Saturn-Logo.svg",
     "https://www.saturn.de"),
    ("Puma", None, "Rabattaktionen für Newsletter-Abonnenten und PUMA-Mitglieder",
     "https://upload.wikimedia.org/wikipedia/en/thumb/d/da/Puma_complete_logo.svg/330px-Puma_complete_logo.svg.png",
     "https://de.puma.com"),
    ("Holy", None, "Ca. 5€ Rabatt auf die erste Bestellung nach Newsletter-Anmeldung",
     None, "https://de.weareholy.com"),
]


# Real photos/logos for well-known providers, sourced from Wikimedia Commons
# -- used as the offer card's start image instead of the generic ticket
# emoji fallback. Applied via a backfill pass in seed_offers() (not baked
# into the tuples above) so it also fixes up offers that were already
# seeded before this existed, on every startup. Not every provider has a
# widely available real image (small local businesses usually don't have a
# Commons entry) -- those simply keep the emoji fallback rather than get a
# fabricated logo.
PROVIDER_IMAGES = {
    "Deutsches Museum": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Deutsches_Museum_Portrait_4.jpg/330px-Deutsches_Museum_Portrait_4.jpg",
    "Tierpark Hellabrunn": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/L%C3%B6wenstatue_Hellabrunn_M%C3%BCnchen.jpg/330px-L%C3%B6wenstatue_Hellabrunn_M%C3%BCnchen.jpg",
    "Zoo Berlin": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Lentr%C3%A9e_du_Zoo_de_Berlin_%286081063158%29.jpg/330px-Lentr%C3%A9e_du_Zoo_de_Berlin_%286081063158%29.jpg",
    "Miniatur Wunderland": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Miniatur_wunderland.jpg/330px-Miniatur_wunderland.jpg",
    "Kölner Zoo": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/K%C3%B6lner_Zoo_%28Flight_over_Cologne%29.jpg/330px-K%C3%B6lner_Zoo_%28Flight_over_Cologne%29.jpg",
    "Zoo Frankfurt": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Zoo-Frankfurt-Gesellschaftshaus-a.jpg/330px-Zoo-Frankfurt-Gesellschaftshaus-a.jpg",
    "Wilhelma": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Wilhelma_Bauten-pjt1.jpg/330px-Wilhelma_Bauten-pjt1.jpg",
    "Zoo Leipzig": "https://upload.wikimedia.org/wikipedia/de/thumb/2/2c/Zoo_Leipzig.svg/langde-330px-Zoo_Leipzig.svg.png",
    "LEGOLAND Deutschland": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Legoland_de_Entrance.jpg/330px-Legoland_de_Entrance.jpg",
    "Phantasialand": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Phantasialand_Logo.svg/langde-330px-Phantasialand_Logo.svg.png",
    "Hofbräuhaus München": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Hofbrauhaus.JPG/330px-Hofbrauhaus.JPG",
    "Schloss Nymphenburg": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Exterior_del_Palacio_de_Nymphenburg%2C_M%C3%BAnich%2C_Alemania61.JPG/330px-Exterior_del_Palacio_de_Nymphenburg%2C_M%C3%BAnich%2C_Alemania61.JPG",
    "Marstallmuseum & Porzellanmuseum Nymphenburg": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Exterior_del_Palacio_de_Nymphenburg%2C_M%C3%BAnich%2C_Alemania61.JPG/330px-Exterior_del_Palacio_de_Nymphenburg%2C_M%C3%BAnich%2C_Alemania61.JPG",
    "Pasinger Fabrik": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/M%C3%BCnchen%2C_Eingang_Pasinger_Fabrik%2C_2.jpeg/330px-M%C3%BCnchen%2C_Eingang_Pasinger_Fabrik%2C_2.jpeg",
    "Mathäser Filmpalast": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Math%C3%A4serfilmpalast.jpg/330px-Math%C3%A4serfilmpalast.jpg",
    "Planetarium Hamburg": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Hamburg_Planetarium.jpg/330px-Hamburg_Planetarium.jpg",
}


def _cents(euro):
    return round(euro * 100) if euro is not None else None


def seed_offers():
    """Idempotently inserts every offer above that isn't already present.
    Safe to call on every app startup -- each insert is guarded by its own
    existence check, so re-running never creates duplicates.
    """
    mathaeser_user = User.query.filter_by(username=MATHAESER["username"]).first()
    if not mathaeser_user:
        mathaeser_user = User(
            username=MATHAESER["username"], is_company=True,
            company_name=MATHAESER["company_name"], company_address=MATHAESER["company_address"],
        )
        mathaeser_user.set_password(MATHAESER["password"])
        db.session.add(mathaeser_user)
        db.session.commit()

    for data in MATHAESER_OFFERS:
        if Offer.query.filter_by(company_id=mathaeser_user.id, title=data["title"]).first():
            continue
        db.session.add(Offer(company_id=mathaeser_user.id, **data))
    db.session.commit()

    for provider, title, category, city, link, normal, discount, max_age, label in REAL_OFFERS:
        if Offer.query.filter_by(provider_name=provider, title=title, city=city).first():
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category, city=city,
            link_url=link, normal_price_cents=_cents(normal), discount_price_cents=_cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
    db.session.commit()

    munich = "München"
    for provider, title, category, link, normal, discount, max_age, label in MUNICH_OFFERS:
        if Offer.query.filter_by(provider_name=provider, title=title, city=munich).first():
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category, city=munich,
            link_url=link, normal_price_cents=_cents(normal), discount_price_cents=_cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
    db.session.commit()

    for provider, title, category, district, link, normal, discount, max_age, label in DISTRICT_OFFERS:
        if Offer.query.filter_by(provider_name=provider, title=title, city=munich).first():
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category,
            city=munich, district=district,
            link_url=link, normal_price_cents=_cents(normal), discount_price_cents=_cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
    db.session.commit()

    for brand, code, description, image_url, link in DISCOUNT_CODES:
        if DiscountCode.query.filter_by(brand_name=brand, description=description).first():
            continue
        db.session.add(DiscountCode(
            brand_name=brand, code=code, description=description,
            image_url=image_url, link_url=link, source_url=link,
        ))
    db.session.commit()

    dirty = False
    for provider, image_url in PROVIDER_IMAGES.items():
        for offer in Offer.query.filter_by(provider_name=provider, image_url=None).all():
            offer.image_url = image_url
            dirty = True
    if dirty:
        db.session.commit()


if __name__ == "__main__":
    from app import app
    with app.app_context():
        offers_before = Offer.query.count()
        codes_before = DiscountCode.query.count()
        seed_offers()
        print(f"Offers: {offers_before} -> {Offer.query.count()}")
        print(f"Rabattcodes: {codes_before} -> {DiscountCode.query.count()}")
