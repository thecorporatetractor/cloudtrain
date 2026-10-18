"""The fictional organisation a dataset describes: users, devices, servers, IP space.

Everything is derived from the lab seed, so two learners with different seeds get
different people, addresses, hosts and timings, and the same seed always gives the
same world.

IP space: no real organisation's addresses are used.
  10.20.0.0/16      office LAN (workstations), 10.30.0.0/24 servers
  203.0.113.0/24    the organisation's own internet egress (RFC 5737 TEST-NET-3)
  198.18.0.0/15     the "internet": residential and mobile ISPs, one /24 per city
                    (RFC 2544 benchmarking range, never routed publicly)
  198.51.100.0/24   a hosting provider (VPS) used by attackers (RFC 5737 TEST-NET-2)
  192.0.2.0/25      SaaS/CDN destinations; 192.0.2.128/25 scanners and other internet noise (RFC 5737 TEST-NET-1)
The IpGeo table maps every one of these ranges to a city, so geo questions are
answered with a lookup (ipv4_lookup / ipv4_is_in_range), not with an external database.
"""
from __future__ import annotations

import hashlib
import random
import uuid
from dataclasses import dataclass, field

COMPANIES = [
    ("Harrowgate Freight", "harrowgate"), ("Bellmont Clinics", "bellmont"),
    ("Orchard Line Foods", "orchardline"), ("Kestrel Ridge Energy", "kestrelridge"),
    ("Tallis and Rowe", "tallisrowe"), ("Marrow Lane Insurance", "marrowlane"),
    ("Pellucid Labs", "pellucid"), ("Quillon Maritime", "quillon"),
]
FIRST = ["Ada", "Bram", "Cleo", "Dario", "Edda", "Femi", "Greta", "Hugo", "Ines", "Jonas",
         "Kaia", "Lars", "Mira", "Nils", "Odile", "Pavel", "Quinn", "Rosa", "Soren", "Tilda",
         "Umar", "Vera", "Wim", "Xenia", "Yusuf", "Zora", "Anouk", "Bas", "Carys", "Dov",
         "Elif", "Felix", "Gwen", "Henrik", "Isla", "Jalen", "Kofi", "Lena", "Mateo", "Noor"]
LAST = ["Abara", "Brandt", "Castell", "Dorsey", "Eklund", "Farrow", "Galloway", "Hollis",
        "Ivers", "Jansen", "Kowal", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Pereira",
        "Quist", "Rasmussen", "Sorensen", "Tamura", "Ulrich", "Varga", "Whitlock", "Yilmaz",
        "Zeller", "Achterberg", "Bianchi", "Cormac", "Delacroix", "Esposito"]
DEPARTMENTS = [("Finance", ["Accountant", "Controller", "Payroll Specialist"]),
               ("Sales", ["Account Executive", "Sales Manager"]),
               ("Operations", ["Dispatcher", "Operations Analyst", "Shift Lead"]),
               ("HR", ["HR Partner", "Recruiter"]),
               ("Engineering", ["Software Engineer", "Data Engineer", "SRE"]),
               ("IT", ["IT Administrator", "Helpdesk Technician", "Cloud Engineer"])]
# (city, state, country code, latitude, longitude, utc offset hours)
OFFICE_CITIES = [("Rotterdam", "South Holland", "NL", 51.92, 4.48, 1),
                 ("Leeds", "England", "GB", 53.80, -1.55, 0),
                 ("Lyon", "Auvergne-Rhone-Alpes", "FR", 45.76, 4.84, 1),
                 ("Porto", "Porto", "PT", 41.15, -8.61, 0),
                 ("Gdansk", "Pomerania", "PL", 54.35, 18.65, 1),
                 ("Aarhus", "Central Jutland", "DK", 56.16, 10.20, 1)]
REMOTE_CITIES = [("Antwerp", "Antwerp", "BE", 51.22, 4.40, 1), ("Bristol", "England", "GB", 51.45, -2.59, 0),
                 ("Hamburg", "Hamburg", "DE", 53.55, 9.99, 1), ("Valencia", "Valencia", "ES", 39.47, -0.38, 1),
                 ("Turin", "Piedmont", "IT", 45.07, 7.69, 1), ("Uppsala", "Uppsala", "SE", 59.86, 17.64, 1)]
FAR_CITIES = [("Lagos", "Lagos", "NG", 6.52, 3.38, 1), ("Jakarta", "Jakarta", "ID", -6.21, 106.85, 7),
              ("Lima", "Lima", "PE", -12.05, -77.04, -5), ("Hanoi", "Hanoi", "VN", 21.03, 105.85, 7),
              ("Almaty", "Almaty", "KZ", 43.24, 76.89, 5), ("Caracas", "Capital District", "VE", 10.49, -66.88, -4),
              ("Manila", "Metro Manila", "PH", 14.60, 120.98, 8), ("Novosibirsk", "Novosibirsk", "RU", 55.01, 82.93, 7)]
OPERATING_SYSTEMS = [("Windows 11", "Edge 131.0.0", 0.55), ("Windows 10", "Chrome 131.0.0", 0.2),
                     ("MacOs", "Safari 18.1", 0.1), ("Ios 18.1", "Mobile Safari", 0.1), ("Android 15", "Chrome Mobile", 0.05)]


def stable_hex(*parts, n=64) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:n]


def stable_uuid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


@dataclass
class City:
    name: str
    state: str
    country: str
    lat: float
    lon: float
    utc: int
    network: str = ""            # x.y.z.0/24 for residential/mobile users there
    asn: int = 0
    asn_org: str = ""
    hosting: bool = False

    def ip(self, rng: random.Random) -> str:
        return self.network.rsplit(".", 1)[0] + f".{rng.randint(2, 250)}"

    def details(self) -> dict:
        return {"city": self.name, "state": self.state, "countryOrRegion": self.country,
                "geoCoordinates": {"latitude": self.lat, "longitude": self.lon}}


@dataclass
class User:
    upn: str
    display: str
    first: str
    sam: str
    user_id: str
    department: str
    title: str
    city: City
    device: str
    device_id: str
    device_ip: str
    os: str
    browser: str
    roles: list = field(default_factory=list)
    traveller: bool = False


@dataclass
class World:
    seed: str
    company: str
    domain: str
    tenant_id: str
    subscription_id: str
    office: City
    egress_ip: str
    cities: list
    hosting: City
    scanner: City
    users: list
    servers: list            # (name, ip, os)
    linux_hosts: list        # (name, ip)

    def user(self, upn: str) -> User:
        return next(u for u in self.users if u.upn == upn)


def build_world(seed: str, n_users: int = 60) -> World:
    rng = random.Random(f"{seed}:world")
    company, slug = rng.choice(COMPANIES)
    domain = f"{slug}.example"
    cities = []
    used = set()

    def net():
        while True:
            c = f"198.{rng.randint(18, 19)}.{rng.randint(0, 255)}.0/24"
            if c not in used:
                used.add(c)
                return c

    for i, t in enumerate(OFFICE_CITIES + REMOTE_CITIES + FAR_CITIES):
        cities.append(City(*t, network=net(), asn=64512 + i, asn_org=f"{t[0]} Broadband"))
    office_name = rng.choice(OFFICE_CITIES)[0]
    office = next(c for c in cities if c.name == office_name)
    remote = [c for c in cities if c.name in {x[0] for x in REMOTE_CITIES}]
    hosting = City(*rng.choice(FAR_CITIES), network="198.51.100.0/24", asn=64600, asn_org="Bluefjord Hosting", hosting=True)
    scanner = City(*rng.choice([c for c in FAR_CITIES if c[0] != hosting.name]), network="192.0.2.128/25",
                   asn=64601, asn_org="Nullroute Transit", hosting=True)
    egress_ip = f"203.0.113.{rng.randint(10, 60)}"

    users, names = [], set()
    dept_weights = [10, 12, 14, 4, 12, 5]
    while len(users) < n_users:
        first, last = rng.choice(FIRST), rng.choice(LAST)
        if (first, last) in names:
            continue
        names.add((first, last))
        dept, titles = rng.choices(DEPARTMENTS, weights=dept_weights)[0]
        osname, browser, _ = rng.choices(OPERATING_SYSTEMS, weights=[o[2] for o in OPERATING_SYSTEMS])[0]
        home = office if rng.random() < 0.75 else rng.choice(remote)
        sam = f"{first[0]}{last}".lower()
        n = len(users) + 1
        users.append(User(
            upn=f"{first}.{last}@{domain}".lower(), display=f"{first} {last}", first=first, sam=sam,
            user_id=stable_uuid(rng), department=dept, title=rng.choice(titles), city=home,
            device=f"{slug[:3].upper()}-LT-{n:03d}", device_id=stable_hex(seed, "dev", n, n=40),
            device_ip=f"10.20.{rng.randint(1, 40)}.{rng.randint(10, 250)}", os=osname, browser=browser,
            traveller=rng.random() < 0.05))
    # IT staff hold the directory roles the stories need.
    it = [u for u in users if u.department == "IT"]
    if len(it) < 3:   # small worlds: promote a few engineers
        for u in [u for u in users if u.department != "IT"][: 3 - len(it)]:
            u.department, u.title = "IT", "IT Administrator"
        it = [u for u in users if u.department == "IT"]
    it[0].roles = ["Global Administrator"]
    it[1].roles = ["Privileged Role Administrator", "User Administrator"]
    for u in it[2:]:
        u.roles = ["Helpdesk Administrator"]
    servers = [(f"{slug[:3].upper()}-{name}", f"10.30.0.{10 + i}", "Windows Server 2022")
               for i, name in enumerate(["DC01", "DC02", "FS01", "APP01", "SQL01", "RDS01"])]
    linux = [(f"{slug[:3]}-{name}", f"10.30.0.{100 + i}") for i, name in enumerate(["bastion01", "web01", "web02", "build01"])]
    return World(seed=seed, company=company, domain=domain, tenant_id=stable_uuid(rng),
                 subscription_id=stable_uuid(rng), office=office, egress_ip=egress_ip, cities=cities,
                 hosting=hosting, scanner=scanner, users=users, servers=servers, linux_hosts=linux)
