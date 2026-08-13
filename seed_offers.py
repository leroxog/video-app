"""One-off/rerunnable seed script: populates the Offer table with ~100
illustrative example listings so the homepage/search/city-sorting have
real volume to browse during development.

These are deliberately generic, non-trademarked placeholder businesses
with placeholder links (example.com) -- NOT real companies with invented
prices, which would be misleading (a real business name + a made-up
price could read as a factual claim). For genuinely real listings, see
the 3 Mathäser Filmpalast entries created earlier via the actual company
account UI, which use real business info.

Run with: .venv/Scripts/python.exe seed_offers.py
"""
import random

from app import app
from models import db, Offer

random.seed(42)

CITIES = [
    "München", "Berlin", "Hamburg", "Köln", "Frankfurt",
    "Stuttgart", "Leipzig", "Dresden", "Düsseldorf", "Hannover",
]

# (category, name_templates, price_range_cents)
CATEGORY_DATA = [
    ("essen", [
        "Pizzeria {city} Altstadt", "Burger House {city}", "Sushi Bar {city} Zentral",
        "Café {city} Mitte", "Restaurant {city} Panorama", "Nudelbar {city}",
        "Steakhouse {city}", "Eisdiele {city} Süd",
    ], (500, 2500)),
    ("unterhaltung", [
        "Kino {city} Nord", "Bowling Center {city}", "Escape Room {city}",
        "Lasertag Arena {city}", "Kegelbahn {city} Alt", "Casino Night {city}",
        "Konzertsaal {city}", "Theater {city} Kammerspiele",
    ], (800, 2000)),
    ("freizeit", [
        "Freizeitpark {city}", "Kletterhalle {city}", "Trampolinpark {city}",
        "Minigolf {city} Park", "Indoor-Spielplatz {city}", "Hochseilgarten {city}",
        "Go-Kart-Bahn {city}", "Wasserpark {city}",
    ], (1000, 3500)),
    ("sport", [
        "Schwimmbad {city} Nord", "Fitnessstudio {city}", "Eishalle {city}",
        "Tennishalle {city}", "Skatepark {city} Halle", "Kletterpark {city}",
        "Boulderhalle {city}", "Squashcenter {city}",
    ], (500, 1500)),
    ("bildung", [
        "Museum {city}", "Planetarium {city}", "Zoo {city}",
        "Aquarium {city}", "Wissenschaftszentrum {city}", "Botanischer Garten {city}",
        "Technikmuseum {city}", "Kindermuseum {city}",
    ], (300, 1200)),
    ("sonstiges", [
        "Wellness-Oase {city}", "Fotostudio {city}", "Spielwarenladen {city}",
        "Kunstgalerie {city}", "Sauna {city} Therme", "Kletterwald {city}",
        "Bibliothek {city} Premium", "Hobbywerkstatt {city}",
    ], (500, 2000)),
]

TARGET_COUNT = 100


def build_offers():
    offers = []
    combos = []
    for category, templates, price_range in CATEGORY_DATA:
        for template in templates:
            for city in CITIES:
                combos.append((category, template, price_range, city))
    random.shuffle(combos)

    for category, template, (lo, hi), city in combos[:TARGET_COUNT]:
        provider_name = template.format(city=city)
        normal_price = random.randint(lo, hi)
        normal_price -= normal_price % 50  # round to nearest 0.50 EUR
        has_discount = random.random() < 0.65
        discount_price = None
        discount_max_age = None
        discount_label = None
        if has_discount:
            discount_max_age = random.choice([10, 12, 14, 16])
            discount_price = round(normal_price * random.uniform(0.55, 0.8))
            discount_price -= discount_price % 50
            discount_label = f"unter {discount_max_age} Jahre"

        slug = provider_name.lower().replace(" ", "-").replace("ü", "ue").replace("ö", "oe").replace("ä", "ae")
        offers.append(Offer(
            company_id=None,
            provider_name=provider_name,
            title="Eintritt" if category in ("freizeit", "sport", "bildung") else "Erlebnis",
            category=category,
            description=f"Beispiel-Angebot in {city} (Demo-Daten, kein echter Anbieter).",
            image_url=None,
            link_url=f"https://example.com/angebot/{slug}",
            city=city,
            normal_price_cents=normal_price,
            discount_price_cents=discount_price,
            discount_max_age=discount_max_age,
            discount_label=discount_label,
        ))
    return offers


with app.app_context():
    existing_demo = Offer.query.filter(Offer.link_url.like("https://example.com/%")).count()
    if existing_demo:
        print(f"{existing_demo} demo offers already exist -- removing them before reseeding.")
        Offer.query.filter(Offer.link_url.like("https://example.com/%")).delete(synchronize_session=False)
        db.session.commit()

    new_offers = build_offers()
    db.session.add_all(new_offers)
    db.session.commit()
    print(f"Seeded {len(new_offers)} demo offers.")
