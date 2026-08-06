"""ConsultUro · Drug Repository — Phase 5.29.

A clinic-scoped, editable library of medications used across both OPD
prescriptions and IPD medication management. Seeded with ~100 entries
relevant to a urology practice, each with one or more popular Indian
brand suggestions.

Each entry is a plain dict:

    {
        "drug_id":          unique slug,
        "name":             generic name (display + search),
        "category":         see CATEGORIES,
        "form":             "tablet" | "capsule" | "syrup" | "injection" | "iv_fluid" | "topical" | "drop" | "spray" | "inhaler",
        "is_injectable":    bool (computed from form),
        "default_strength": e.g. "500 mg", "1 g", "0.9%",
        "default_dose":     e.g. "1 tab", "1 g",
        "default_frequency":"OD" | "BD" | "TDS" | "QID" | "HS" | "SOS" | "STAT" | "Q8H" | …,
        "default_route":    "PO" | "IV" | "IM" | "SC" | "Topical" | "PR" | "SL" | "Nebulizer",
        "default_duration": e.g. "5 days",
        "brands":           ["Augmentin", "Clavam", …],
        "notes":            short clinician tip (optional),
    }

The list intentionally mixes urology-specific drugs (α-blockers,
5-AR-inhibitors, intravesical agents) with the general hospital
formulary needed during admission (antibiotics, IV fluids,
analgesics, etc.).
"""

from typing import List, Dict, Any

CATEGORIES = [
    "Antibiotic",
    "Analgesic",
    "Antacid / PPI",
    "Antiemetic",
    "Antifungal",
    "IV Fluid",
    "Alpha-blocker (BPH/Stone)",
    "5-AR Inhibitor",
    "Antispasmodic",
    "OAB / Anticholinergic",
    "Diuretic",
    "Antihypertensive",
    "Anticoagulant",
    "Hemostatic",
    "Corticosteroid",
    "Antihistamine",
    "PDE5 Inhibitor",
    "Urology — Other",
    "Electrolyte",
    "Laxative",
    "Other",
]


def _entry(
    name: str, category: str, form: str, strength: str, dose: str, freq: str,
    route: str, duration: str, brands: List[str], notes: str = "",
) -> Dict[str, Any]:
    inj = form in ("injection", "iv_fluid")
    return {
        "drug_id": (name.lower().replace(" ", "_").replace("/", "_").replace("-", "_").replace("+", "_").replace(",", "")[:48]) + ("_" + form[:3] if form not in ("tablet", "injection") else ""),
        "name": name,
        "category": category,
        "form": form,
        "is_injectable": inj,
        "default_strength": strength,
        "default_dose": dose,
        "default_frequency": freq,
        "default_route": route,
        "default_duration": duration,
        "brands": brands,
        "notes": notes,
    }


SEED_DRUGS: List[Dict[str, Any]] = [
    # ─── Antibiotics ────────────────────────────────────────────────
    _entry("Amoxicillin + Clavulanate", "Antibiotic", "tablet", "625 mg", "1 tab", "BD", "PO", "5 days", ["Augmentin 625", "Clavam 625", "Moxikind-CV 625"]),
    _entry("Amoxicillin + Clavulanate", "Antibiotic", "injection", "1.2 g", "1.2 g", "TDS", "IV", "5 days", ["Augmentin 1.2 g", "Mega-Clav 1.2 g"], "Slow IV over 3–4 min."),
    _entry("Ceftriaxone", "Antibiotic", "injection", "1 g", "1 g", "BD", "IV", "5 days", ["Monocef", "Oframax", "Ceftrim"]),
    _entry("Cefoperazone + Sulbactam", "Antibiotic", "injection", "1.5 g", "1.5 g", "BD", "IV", "5 days", ["Magnex Forte", "Sulbacef"]),
    _entry("Piperacillin + Tazobactam", "Antibiotic", "injection", "4.5 g", "4.5 g", "Q8H", "IV", "7 days", ["Zosyn", "Piptaz", "Tazact"]),
    _entry("Meropenem", "Antibiotic", "injection", "1 g", "1 g", "Q8H", "IV", "7 days", ["Meronem", "Pencom"]),
    _entry("Imipenem + Cilastatin", "Antibiotic", "injection", "500 mg", "500 mg", "Q6H", "IV", "7 days", ["Cilanem", "Imipem"]),
    _entry("Ciprofloxacin", "Antibiotic", "tablet", "500 mg", "1 tab", "BD", "PO", "7 days", ["Ciplox 500", "Cifran"]),
    _entry("Levofloxacin", "Antibiotic", "tablet", "500 mg", "1 tab", "OD", "PO", "7 days", ["Levoflox", "Tavanic", "Lquin"]),
    _entry("Nitrofurantoin", "Antibiotic", "tablet", "100 mg", "1 tab", "BD", "PO", "5 days", ["Niftran", "Martifur"], "First-line for uncomplicated UTI."),
    _entry("Cotrimoxazole (TMP-SMX)", "Antibiotic", "tablet", "DS 800/160", "1 tab", "BD", "PO", "5 days", ["Septran DS", "Bactrim DS"]),
    _entry("Fosfomycin", "Antibiotic", "tablet", "3 g sachet", "3 g", "STAT", "PO", "Single dose", ["Fosfocin", "Monurol", "Fosvex"]),
    _entry("Cefixime", "Antibiotic", "tablet", "200 mg", "1 tab", "BD", "PO", "5 days", ["Taxim-O", "Mahacef", "Cefolac"]),
    _entry("Cefpodoxime", "Antibiotic", "tablet", "200 mg", "1 tab", "BD", "PO", "5 days", ["Cefoprox", "Doxcef"]),
    _entry("Amikacin", "Antibiotic", "injection", "500 mg", "500 mg", "BD", "IV", "7 days", ["Amikacin", "Mikacin"]),
    _entry("Gentamicin", "Antibiotic", "injection", "80 mg", "80 mg", "TDS", "IV", "5 days", ["Genticyn", "Gentamycin"]),
    _entry("Doxycycline", "Antibiotic", "tablet", "100 mg", "1 tab", "BD", "PO", "7 days", ["Doxy-1", "Doxt-SL"]),
    _entry("Linezolid", "Antibiotic", "tablet", "600 mg", "1 tab", "BD", "PO", "10 days", ["Linospan", "Lizolid"]),
    _entry("Vancomycin", "Antibiotic", "injection", "1 g", "1 g", "BD", "IV", "10 days", ["Vancocin", "Vancogen"], "Trough monitoring required."),
    _entry("Tigecycline", "Antibiotic", "injection", "50 mg", "50 mg", "BD", "IV", "7 days", ["Tigecycline", "Tygacil"]),
    _entry("Colistin", "Antibiotic", "injection", "1 MIU", "2 MIU LD then 1 MIU", "Q8H", "IV", "10 days", ["Walomycin", "Colistimax"]),

    # ─── Analgesics ─────────────────────────────────────────────────
    _entry("Paracetamol", "Analgesic", "tablet", "650 mg", "1 tab", "QID", "PO", "5 days", ["Crocin 650", "Dolo 650", "Calpol 650"]),
    _entry("Paracetamol", "Analgesic", "injection", "1 g", "1 g", "TDS", "IV", "3 days", ["PCM IV", "Fevastin"]),
    _entry("Diclofenac", "Analgesic", "tablet", "50 mg", "1 tab", "BD", "PO", "3 days", ["Voveran", "Volini Pain Relief"]),
    _entry("Diclofenac", "Analgesic", "injection", "75 mg", "75 mg", "BD", "IM", "2 days", ["Voveran inj", "Dynapar AQ"]),
    _entry("Tramadol", "Analgesic", "injection", "100 mg", "100 mg", "TDS", "IV", "3 days", ["Tramazac", "Domadol", "Contramal"]),
    _entry("Ketorolac", "Analgesic", "injection", "30 mg", "30 mg", "BD", "IM", "2 days", ["Ketrol", "Ketanov"]),
    _entry("Aceclofenac + Paracetamol", "Analgesic", "tablet", "100 + 325 mg", "1 tab", "BD", "PO", "5 days", ["Zerodol-P", "Hifenac-P"]),
    _entry("Mefenamic acid", "Analgesic", "tablet", "500 mg", "1 tab", "TDS", "PO", "3 days", ["Meftal-500", "Ponstan"]),
    _entry("Buprenorphine", "Analgesic", "injection", "0.3 mg", "0.3 mg", "Q8H", "IM", "2 days", ["Norphin", "Tidigesic"]),
    _entry("Fentanyl", "Analgesic", "injection", "100 mcg", "1–2 mcg/kg", "SOS", "IV", "PRN", ["Fenstud", "Fentanyl"], "Anaesthesia / severe pain only."),
    _entry("Morphine", "Analgesic", "injection", "15 mg", "5–10 mg", "Q4H", "SC", "PRN", ["Morcontin", "Morphine inj"]),

    # ─── Antacid / PPI ──────────────────────────────────────────────
    _entry("Pantoprazole", "Antacid / PPI", "tablet", "40 mg", "1 tab", "OD", "PO", "5 days", ["Pan-40", "Pantocid 40", "Pantop 40"]),
    _entry("Pantoprazole", "Antacid / PPI", "injection", "40 mg", "40 mg", "OD", "IV", "5 days", ["Pan-IV", "Pantocid IV"]),
    _entry("Omeprazole", "Antacid / PPI", "capsule", "20 mg", "1 cap", "OD", "PO", "5 days", ["Omez", "Ocid"]),
    _entry("Rabeprazole", "Antacid / PPI", "tablet", "20 mg", "1 tab", "OD", "PO", "5 days", ["Razo", "Rablet", "Pariet"]),
    _entry("Esomeprazole", "Antacid / PPI", "tablet", "40 mg", "1 tab", "OD", "PO", "5 days", ["Nexpro", "Nexium", "Esoz"]),
    _entry("Ranitidine", "Antacid / PPI", "injection", "50 mg", "50 mg", "BD", "IV", "3 days", ["Aciloc", "Rantac"]),
    _entry("Sucralfate", "Antacid / PPI", "syrup", "1 g/10 ml", "10 ml", "QID", "PO", "5 days", ["Sucrafil", "Sucral O"]),

    # ─── Antiemetic ─────────────────────────────────────────────────
    _entry("Ondansetron", "Antiemetic", "tablet", "4 mg", "1 tab", "TDS", "PO", "PRN", ["Emeset", "Vomikind", "Ondem"]),
    _entry("Ondansetron", "Antiemetic", "injection", "4 mg", "4 mg", "TDS", "IV", "2 days", ["Emeset inj", "Ondansetron inj"]),
    _entry("Granisetron", "Antiemetic", "injection", "1 mg", "1 mg", "BD", "IV", "2 days", ["Graniset", "Kytril"]),
    _entry("Domperidone", "Antiemetic", "tablet", "10 mg", "1 tab", "TDS", "PO", "3 days", ["Domstal", "Vomistop"]),
    _entry("Metoclopramide", "Antiemetic", "injection", "10 mg", "10 mg", "TDS", "IV", "2 days", ["Perinorm", "Reglan"]),
    _entry("Palonosetron", "Antiemetic", "injection", "0.25 mg", "0.25 mg", "STAT", "IV", "Single dose", ["Aloxi", "Palozen"]),
    _entry("Promethazine", "Antiemetic", "injection", "25 mg", "25 mg", "TDS", "IM", "2 days", ["Phenergan", "Avomine"]),

    # ─── Antifungal ─────────────────────────────────────────────────
    _entry("Fluconazole", "Antifungal", "tablet", "150 mg", "1 tab", "OD", "PO", "Single dose", ["Forcan", "Zocon"]),
    _entry("Fluconazole", "Antifungal", "injection", "200 mg", "200 mg", "OD", "IV", "7 days", ["Forcan IV", "Zocon IV"]),
    _entry("Voriconazole", "Antifungal", "injection", "200 mg", "200 mg", "BD", "IV", "7 days", ["Vfend", "Voritek"]),
    _entry("Caspofungin", "Antifungal", "injection", "50 mg", "70 mg LD then 50 mg", "OD", "IV", "10 days", ["Cancidas", "Caspozid"]),
    _entry("Itraconazole", "Antifungal", "capsule", "100 mg", "1 cap", "BD", "PO", "7 days", ["Sporanox", "Canditral"]),

    # ─── IV Fluids ──────────────────────────────────────────────────
    _entry("Normal Saline 0.9%", "IV Fluid", "iv_fluid", "500 ml", "100 ml/hr", "Continuous", "IV", "Per fluid plan", ["NS 500 ml", "Sodium Chloride 0.9%"]),
    _entry("Dextrose Normal Saline (DNS)", "IV Fluid", "iv_fluid", "500 ml", "100 ml/hr", "Continuous", "IV", "Per fluid plan", ["DNS 500 ml"]),
    _entry("Ringer Lactate", "IV Fluid", "iv_fluid", "500 ml", "100 ml/hr", "Continuous", "IV", "Per fluid plan", ["RL 500 ml", "Compound Sodium Lactate"]),
    _entry("Dextrose 5%", "IV Fluid", "iv_fluid", "500 ml", "100 ml/hr", "Continuous", "IV", "Per fluid plan", ["D5W 500 ml"]),
    _entry("Dextrose 10%", "IV Fluid", "iv_fluid", "500 ml", "60 ml/hr", "Continuous", "IV", "Per fluid plan", ["D10 500 ml"]),
    _entry("Dextrose 25%", "IV Fluid", "iv_fluid", "100 ml", "25 ml SOS", "PRN", "IV", "PRN", ["D25 100 ml"], "Hypoglycemia rescue."),
    _entry("Isolyte M", "IV Fluid", "iv_fluid", "500 ml", "60 ml/hr", "Continuous", "IV", "Per fluid plan", ["Isolyte M"]),
    _entry("Isolyte P", "IV Fluid", "iv_fluid", "500 ml", "60 ml/hr", "Continuous", "IV", "Per fluid plan", ["Isolyte P"]),
    _entry("Plasmalyte A", "IV Fluid", "iv_fluid", "500 ml", "100 ml/hr", "Continuous", "IV", "Per fluid plan", ["Plasmalyte A"]),
    _entry("Mannitol 20%", "IV Fluid", "iv_fluid", "100 ml", "0.5 g/kg", "Q6H", "IV", "PRN", ["Mannitol 20%"], "Slow infusion 20–30 min."),

    # ─── Alpha-blockers / BPH / Stone ───────────────────────────────
    _entry("Tamsulosin", "Alpha-blocker (BPH/Stone)", "capsule", "0.4 mg", "1 cap", "HS", "PO", "30 days", ["Urimax 0.4", "Veltam 0.4", "Flomax"]),
    _entry("Silodosin", "Alpha-blocker (BPH/Stone)", "capsule", "8 mg", "1 cap", "OD", "PO", "30 days", ["Silofast", "Urief"]),
    _entry("Alfuzosin SR", "Alpha-blocker (BPH/Stone)", "tablet", "10 mg", "1 tab", "OD", "PO", "30 days", ["Alfusin SR", "Urilief SR"]),
    _entry("Doxazosin", "Alpha-blocker (BPH/Stone)", "tablet", "2 mg", "1 tab", "HS", "PO", "30 days", ["Doxacard", "Doxoral"]),
    _entry("Terazosin", "Alpha-blocker (BPH/Stone)", "tablet", "2 mg", "1 tab", "HS", "PO", "30 days", ["Hytrin", "Olyster"]),

    # ─── 5-AR Inhibitors ────────────────────────────────────────────
    _entry("Finasteride", "5-AR Inhibitor", "tablet", "5 mg", "1 tab", "OD", "PO", "90 days", ["Finast", "Finpecia 5"]),
    _entry("Dutasteride", "5-AR Inhibitor", "capsule", "0.5 mg", "1 cap", "OD", "PO", "90 days", ["Dutas", "Veltride"]),
    _entry("Dutasteride + Tamsulosin", "5-AR Inhibitor", "capsule", "0.5 + 0.4 mg", "1 cap", "OD", "PO", "90 days", ["Veltam Plus", "Urimax-D"]),

    # ─── Antispasmodics ─────────────────────────────────────────────
    _entry("Drotaverine", "Antispasmodic", "tablet", "80 mg", "1 tab", "TDS", "PO", "3 days", ["Drotin", "Doverin"]),
    _entry("Drotaverine", "Antispasmodic", "injection", "40 mg", "40 mg", "TDS", "IM", "2 days", ["Drotin inj"]),
    _entry("Hyoscine butylbromide", "Antispasmodic", "injection", "20 mg", "20 mg", "TDS", "IV", "2 days", ["Buscopan", "Hyocimax"]),
    _entry("Flavoxate", "Antispasmodic", "tablet", "200 mg", "1 tab", "TDS", "PO", "5 days", ["Urispas", "Flav"]),
    _entry("Oxybutynin", "Antispasmodic", "tablet", "5 mg", "1 tab", "BD", "PO", "30 days", ["Cystran", "Oxybutyn"]),
    _entry("Phenazopyridine", "Antispasmodic", "tablet", "100 mg", "1 tab", "TDS", "PO", "3 days", ["Pyridium", "Phenex"], "Urinary analgesic — stains urine orange."),

    # ─── OAB / Anticholinergic ──────────────────────────────────────
    _entry("Solifenacin", "OAB / Anticholinergic", "tablet", "5 mg", "1 tab", "OD", "PO", "30 days", ["Vesicare", "Solitone"]),
    _entry("Mirabegron", "OAB / Anticholinergic", "tablet", "50 mg", "1 tab", "OD", "PO", "30 days", ["Mybetriq", "Tovas"]),
    _entry("Trospium", "OAB / Anticholinergic", "tablet", "20 mg", "1 tab", "BD", "PO", "30 days", ["Trosec"]),
    _entry("Darifenacin", "OAB / Anticholinergic", "tablet", "7.5 mg", "1 tab", "OD", "PO", "30 days", ["Darifast", "Dartin"]),

    # ─── Diuretics ──────────────────────────────────────────────────
    _entry("Furosemide", "Diuretic", "tablet", "40 mg", "1 tab", "OD", "PO", "Per plan", ["Lasix", "Frusix"]),
    _entry("Furosemide", "Diuretic", "injection", "20 mg", "20 mg", "BD", "IV", "PRN", ["Lasix inj"]),
    _entry("Torsemide", "Diuretic", "tablet", "10 mg", "1 tab", "OD", "PO", "Per plan", ["Dytor", "Tide 10"]),
    _entry("Spironolactone", "Diuretic", "tablet", "25 mg", "1 tab", "BD", "PO", "Per plan", ["Aldactone", "Spirolang"]),
    _entry("Hydrochlorothiazide", "Diuretic", "tablet", "12.5 mg", "1 tab", "OD", "PO", "Per plan", ["Aquazide", "HCTZ"]),

    # ─── Antihypertensives ──────────────────────────────────────────
    _entry("Amlodipine", "Antihypertensive", "tablet", "5 mg", "1 tab", "OD", "PO", "Per plan", ["Amlong", "Stamlo", "Amlovas"]),
    _entry("Telmisartan", "Antihypertensive", "tablet", "40 mg", "1 tab", "OD", "PO", "Per plan", ["Telma", "Telsartan"]),
    _entry("Metoprolol", "Antihypertensive", "tablet", "25 mg", "1 tab", "BD", "PO", "Per plan", ["Metolar", "Met XL"]),
    _entry("Labetalol", "Antihypertensive", "injection", "20 mg", "20 mg", "BD", "IV", "PRN", ["Lobet inj"]),

    # ─── Anticoagulants ─────────────────────────────────────────────
    _entry("Enoxaparin", "Anticoagulant", "injection", "40 mg", "40 mg", "OD", "SC", "Per plan", ["Clexane", "Lonopin", "Enoxan"]),
    _entry("Heparin", "Anticoagulant", "injection", "5000 IU", "5000 IU", "BD", "SC", "Per plan", ["Beparine", "Heparin sodium"]),
    _entry("Warfarin", "Anticoagulant", "tablet", "5 mg", "Per INR", "OD", "PO", "Per plan", ["Warf", "Uniwarfin"], "Monitor INR closely."),
    _entry("Rivaroxaban", "Anticoagulant", "tablet", "10 mg", "1 tab", "OD", "PO", "Per plan", ["Xarelto", "Rivaflo"]),
    _entry("Aspirin", "Anticoagulant", "tablet", "75 mg", "1 tab", "OD", "PO", "Per plan", ["Ecosprin", "Aspico"]),

    # ─── Hemostatic ─────────────────────────────────────────────────
    _entry("Tranexamic acid", "Hemostatic", "tablet", "500 mg", "1 tab", "TDS", "PO", "3 days", ["Pause", "Trapic"]),
    _entry("Tranexamic acid", "Hemostatic", "injection", "500 mg", "500 mg", "TDS", "IV", "2 days", ["Trapic inj", "Pause inj"]),
    _entry("Ethamsylate", "Hemostatic", "injection", "250 mg", "250 mg", "TDS", "IV", "2 days", ["Dicynene"]),
    _entry("Vitamin K", "Hemostatic", "injection", "10 mg", "10 mg", "OD", "IM", "3 days", ["K-Vit", "Kapilin"]),

    # ─── Corticosteroids ────────────────────────────────────────────
    _entry("Hydrocortisone", "Corticosteroid", "injection", "100 mg", "100 mg", "Q6H", "IV", "PRN", ["Efcorlin", "Hydrocort"]),
    _entry("Methylprednisolone", "Corticosteroid", "injection", "40 mg", "40 mg", "OD", "IV", "PRN", ["Solu-Medrol", "Depo-Medrol"]),
    _entry("Dexamethasone", "Corticosteroid", "injection", "4 mg", "4 mg", "BD", "IV", "PRN", ["Decadron", "Dexona"]),

    # ─── Antihistamines ─────────────────────────────────────────────
    _entry("Pheniramine maleate", "Antihistamine", "injection", "22.75 mg", "22.75 mg", "BD", "IV", "PRN", ["Avil", "Pheniramine"]),
    _entry("Cetirizine", "Antihistamine", "tablet", "10 mg", "1 tab", "HS", "PO", "5 days", ["Cetzine", "Alerid"]),
    _entry("Levocetirizine", "Antihistamine", "tablet", "5 mg", "1 tab", "HS", "PO", "5 days", ["Levocet", "Teczine"]),

    # ─── PDE5 Inhibitors ────────────────────────────────────────────
    _entry("Sildenafil", "PDE5 Inhibitor", "tablet", "50 mg", "1 tab", "SOS", "PO", "PRN", ["Viagra", "Penegra", "Suhagra"], "Take 1 hr before activity."),
    _entry("Tadalafil", "PDE5 Inhibitor", "tablet", "10 mg", "1 tab", "SOS", "PO", "PRN", ["Cialis", "Tadalip", "Megalis"]),
    _entry("Tadalafil 5 mg daily", "PDE5 Inhibitor", "tablet", "5 mg", "1 tab", "OD", "PO", "30 days", ["Tadalip 5", "Megalis 5"], "Daily dosing for BPH + ED."),

    # ─── Urology — Other ────────────────────────────────────────────
    _entry("Mitomycin C (intravesical)", "Urology — Other", "injection", "40 mg", "40 mg in 40 ml NS", "Weekly", "Intravesical", "6 weeks", ["Mitomycin"], "Intravesical for NMIBC."),
    _entry("BCG (intravesical)", "Urology — Other", "injection", "81 mg", "1 vial in 50 ml NS", "Weekly", "Intravesical", "6 weeks", ["Onco-BCG", "TICE BCG"]),
    _entry("Potassium citrate", "Urology — Other", "syrup", "1 g/5 ml", "10 ml", "TDS", "PO", "30 days", ["Citralka", "Cital", "K-Citrate"], "Alkalinise urine — stones."),
    _entry("Allopurinol", "Urology — Other", "tablet", "100 mg", "1 tab", "OD", "PO", "30 days", ["Zyloric", "Ciploric"]),
    _entry("Febuxostat", "Urology — Other", "tablet", "40 mg", "1 tab", "OD", "PO", "30 days", ["Febuget", "Zurig"]),

    # ─── Electrolytes ───────────────────────────────────────────────
    _entry("Potassium chloride", "Electrolyte", "injection", "20 mEq", "20 mEq in 500 ml NS", "PRN", "IV", "PRN", ["KCl 20 mEq"], "Never bolus — slow infusion only."),
    _entry("Magnesium sulphate", "Electrolyte", "injection", "1 g", "1–2 g", "PRN", "IV", "PRN", ["MgSO4 inj"]),
    _entry("Calcium gluconate", "Electrolyte", "injection", "10%", "10 ml slow IV", "PRN", "IV", "PRN", ["Calcium Gluconate"]),

    # ─── Laxatives ──────────────────────────────────────────────────
    _entry("Lactulose", "Laxative", "syrup", "10 g/15 ml", "15 ml", "HS", "PO", "5 days", ["Duphalac", "Looz"]),
    _entry("Bisacodyl", "Laxative", "tablet", "5 mg", "2 tab", "HS", "PO", "PRN", ["Dulcolax", "Cremalax"]),
    _entry("Glycerin suppository", "Laxative", "topical", "1 supp", "1 supp", "OD", "PR", "PRN", ["Glycerin Supp"]),

    # ─── Other ──────────────────────────────────────────────────────
    _entry("Insulin Regular", "Other", "injection", "100 IU/ml", "Sliding scale", "QID", "SC", "Per plan", ["Actrapid", "Huminsulin R"]),
    _entry("Insulin NPH", "Other", "injection", "100 IU/ml", "Per plan", "BD", "SC", "Per plan", ["Insulatard", "Huminsulin N"]),
    _entry("Atorvastatin", "Other", "tablet", "10 mg", "1 tab", "HS", "PO", "Per plan", ["Storvas", "Atorlip", "Lipikind"]),
    _entry("Metformin", "Other", "tablet", "500 mg", "1 tab", "BD", "PO", "Per plan", ["Glycomet", "Glucophage"]),
    _entry("Salbutamol + Ipratropium", "Other", "spray", "2.5 mg + 0.5 mg", "Resp 2.5 ml", "QID", "Nebulizer", "PRN", ["Duolin Resp", "Combimist"]),
]


def get_seed_drugs() -> List[Dict[str, Any]]:
    """Return a fresh copy of the seed list (defensive copy)."""
    return [dict(d) for d in SEED_DRUGS]
