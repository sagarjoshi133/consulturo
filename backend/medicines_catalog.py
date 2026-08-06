"""
Seed catalogue of common urology medicines — bootstraps the
/api/medicines/catalog endpoint so prescribers get autocomplete
even on day 1.

This is curated for Indian urology practice (Dr Sagar Joshi). Each
entry carries:
  - name: display name (generic + strength)
  - generic: INN / generic ingredient (used for search)
  - brands: list[str] — common Indian brand names (shown as a hint)
  - category: therapeutic class, used for filter chips
  - dosage: default strength to prefill
  - frequency: default OD / BD / TID etc.
  - duration: default as a display string
  - timing: relative to food (optional)
  - instructions: patient-counselling line (optional)
"""
from typing import List, Dict, Any


UROLOGY_MEDICINES: List[Dict[str, Any]] = [
    # ==================================================================
    # BPH — ALPHA-BLOCKERS
    # ==================================================================
    {"name": "Tamsulosin 0.4 mg", "generic": "Tamsulosin", "brands": ["Urimax", "Veltam", "Flotral", "Urotone"], "category": "Alpha-blocker", "dosage": "0.4 mg", "frequency": "HS", "duration": "30 days", "timing": "After dinner", "instructions": "Take at bedtime; may cause mild dizziness initially."},
    {"name": "Tamsulosin 0.2 mg", "generic": "Tamsulosin", "brands": ["Urimax-0.2", "Contiflo"], "category": "Alpha-blocker", "dosage": "0.2 mg", "frequency": "HS", "duration": "30 days", "timing": "After dinner"},
    {"name": "Silodosin 8 mg", "generic": "Silodosin", "brands": ["Silofast", "Urorec", "Urief"], "category": "Alpha-blocker", "dosage": "8 mg", "frequency": "OD", "duration": "30 days", "timing": "With dinner", "instructions": "Retrograde ejaculation is common and harmless."},
    {"name": "Silodosin 4 mg", "generic": "Silodosin", "brands": ["Silofast-4", "Urorec-4"], "category": "Alpha-blocker", "dosage": "4 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Alfuzosin SR 10 mg", "generic": "Alfuzosin", "brands": ["Alfusin-D", "Flotral", "Alfoo"], "category": "Alpha-blocker", "dosage": "10 mg", "frequency": "OD", "duration": "30 days", "timing": "After dinner"},
    {"name": "Alfuzosin 2.5 mg", "generic": "Alfuzosin", "brands": ["Alfusin", "Xatral"], "category": "Alpha-blocker", "dosage": "2.5 mg", "frequency": "TID", "duration": "30 days"},
    {"name": "Terazosin 5 mg", "generic": "Terazosin", "brands": ["Olyster", "Hytrin", "Terapress"], "category": "Alpha-blocker", "dosage": "5 mg", "frequency": "HS", "duration": "30 days"},
    {"name": "Terazosin 2 mg", "generic": "Terazosin", "brands": ["Olyster-2", "Hytrin-2"], "category": "Alpha-blocker", "dosage": "2 mg", "frequency": "HS", "duration": "30 days", "instructions": "Start low; watch for first-dose hypotension."},
    {"name": "Doxazosin 4 mg", "generic": "Doxazosin", "brands": ["Doxacard", "Duracard"], "category": "Alpha-blocker", "dosage": "4 mg", "frequency": "HS", "duration": "30 days"},
    {"name": "Doxazosin 1 mg", "generic": "Doxazosin", "brands": ["Doxacard-1"], "category": "Alpha-blocker", "dosage": "1 mg", "frequency": "HS", "duration": "7 days", "instructions": "Titration starter; double every 7 days."},
    {"name": "Prazosin 2.5 mg", "generic": "Prazosin", "brands": ["Minipress XL", "Prazopress"], "category": "Alpha-blocker", "dosage": "2.5 mg", "frequency": "OD", "duration": "30 days"},

    # ==================================================================
    # BPH — 5-ALPHA REDUCTASE INHIBITORS
    # ==================================================================
    {"name": "Finasteride 5 mg", "generic": "Finasteride", "brands": ["Finast", "Finpecia-5", "Finax"], "category": "5-alpha reductase", "dosage": "5 mg", "frequency": "OD", "duration": "90 days", "instructions": "Takes 3-6 months for full effect."},
    {"name": "Finasteride 1 mg", "generic": "Finasteride", "brands": ["Finpecia", "Fincar-1", "Finax-1"], "category": "5-alpha reductase", "dosage": "1 mg", "frequency": "OD", "duration": "90 days", "instructions": "For androgenic alopecia."},
    {"name": "Dutasteride 0.5 mg", "generic": "Dutasteride", "brands": ["Dutas", "Duprost", "Avodart"], "category": "5-alpha reductase", "dosage": "0.5 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Dutasteride + Tamsulosin (0.5/0.4 mg)", "generic": "Dutasteride+Tamsulosin", "brands": ["Dutas-T", "Duprost-T", "Veltam-Plus"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},
    {"name": "Finasteride + Tamsulosin (5/0.4 mg)", "generic": "Finasteride+Tamsulosin", "brands": ["Finast-T", "Urimax-F"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},
    {"name": "Alfuzosin + Dutasteride (10/0.5 mg)", "generic": "Alfuzosin+Dutasteride", "brands": ["Alfusin-D Plus"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},
    {"name": "Silodosin + Dutasteride (8/0.5 mg)", "generic": "Silodosin+Dutasteride", "brands": ["Silofast-D"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},
    {"name": "Tadalafil 5 mg (daily BPH)", "generic": "Tadalafil", "brands": ["Tadacip-5", "Megalis-5", "Forzest-5"], "category": "ED / BPH", "dosage": "5 mg", "frequency": "OD", "duration": "30 days", "instructions": "Dual benefit in BPH with ED."},

    # ==================================================================
    # OAB — ANTICHOLINERGICS & BETA-3 AGONISTS
    # ==================================================================
    {"name": "Solifenacin 5 mg", "generic": "Solifenacin", "brands": ["Vesicare", "Soligen"], "category": "OAB", "dosage": "5 mg", "frequency": "OD", "duration": "30 days", "instructions": "Report dry mouth or constipation."},
    {"name": "Solifenacin 10 mg", "generic": "Solifenacin", "brands": ["Vesicare-10", "Soligen-10"], "category": "OAB", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Tolterodine ER 4 mg", "generic": "Tolterodine", "brands": ["Detrol LA", "Roliten-LA", "Tolter"], "category": "OAB", "dosage": "4 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Tolterodine IR 2 mg", "generic": "Tolterodine", "brands": ["Roliten", "Tolter-2"], "category": "OAB", "dosage": "2 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Darifenacin ER 7.5 mg", "generic": "Darifenacin", "brands": ["Darinol", "Darifen"], "category": "OAB", "dosage": "7.5 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Darifenacin ER 15 mg", "generic": "Darifenacin", "brands": ["Darinol-15"], "category": "OAB", "dosage": "15 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Trospium 20 mg", "generic": "Trospium", "brands": ["Trosec"], "category": "OAB", "dosage": "20 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Oxybutynin 5 mg", "generic": "Oxybutynin", "brands": ["Oxyspas", "Cystran"], "category": "OAB", "dosage": "5 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Oxybutynin ER 10 mg", "generic": "Oxybutynin", "brands": ["Oxyspas-ER"], "category": "OAB", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Flavoxate 200 mg", "generic": "Flavoxate", "brands": ["Urispas", "Flavate"], "category": "OAB", "dosage": "200 mg", "frequency": "TID", "duration": "7 days"},
    {"name": "Fesoterodine 4 mg", "generic": "Fesoterodine", "brands": ["Toviaz"], "category": "OAB", "dosage": "4 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Mirabegron 25 mg", "generic": "Mirabegron", "brands": ["Mirabeg", "Betmiga-25"], "category": "OAB", "dosage": "25 mg", "frequency": "OD", "duration": "30 days", "instructions": "Monitor BP if hypertensive."},
    {"name": "Mirabegron 50 mg", "generic": "Mirabegron", "brands": ["Mirabeg-50", "Betmiga"], "category": "OAB", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Solifenacin + Tamsulosin (6/0.4 mg)", "generic": "Solifenacin+Tamsulosin", "brands": ["Vesomni"], "category": "OAB", "dosage": "1 tab", "frequency": "OD", "duration": "30 days"},

    # ==================================================================
    # NOCTURIA / DESMOPRESSIN
    # ==================================================================
    {"name": "Desmopressin 60 mcg SL", "generic": "Desmopressin", "brands": ["Minirin", "Nocdurna"], "category": "Nocturia", "dosage": "60 mcg SL", "frequency": "HS", "duration": "30 days", "instructions": "Restrict fluids 1 h before; monitor Na+."},
    {"name": "Desmopressin 0.2 mg PO", "generic": "Desmopressin", "brands": ["Minirin-0.2"], "category": "Nocturia", "dosage": "0.2 mg", "frequency": "HS", "duration": "30 days"},
    {"name": "Desmopressin Nasal 10 mcg", "generic": "Desmopressin", "brands": ["Minirin Nasal"], "category": "Nocturia", "dosage": "10 mcg nasal", "frequency": "HS", "duration": "30 days"},

    # ==================================================================
    # UROLITHIASIS / STONES
    # ==================================================================
    {"name": "Tamsulosin 0.4 mg (MET)", "generic": "Tamsulosin", "brands": ["Urimax", "Veltam"], "category": "Stones", "dosage": "0.4 mg", "frequency": "HS", "duration": "14 days", "instructions": "Medical expulsive therapy — continue up to 4 weeks."},
    {"name": "Potassium Citrate 10 mEq", "generic": "Potassium citrate", "brands": ["K-Bind", "Potrate", "Alkasol"], "category": "Stones", "dosage": "10 mEq", "frequency": "TID", "duration": "60 days", "instructions": "Calcium stone prevention; monitor K+ yearly."},
    {"name": "Potassium Citrate + Magnesium + B6", "generic": "K-citrate+Mg+B6", "brands": ["Cital-UT", "Urikind-K"], "category": "Stones", "dosage": "10 ml", "frequency": "TID", "duration": "30 days", "timing": "After food"},
    {"name": "Allopurinol 100 mg", "generic": "Allopurinol", "brands": ["Zyloric", "Zyloprim", "Ciploric"], "category": "Stones", "dosage": "100 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Allopurinol 300 mg", "generic": "Allopurinol", "brands": ["Zyloric-300", "Ciploric-300"], "category": "Stones", "dosage": "300 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Febuxostat 40 mg", "generic": "Febuxostat", "brands": ["Feburic", "Zurig", "Febutaz"], "category": "Stones", "dosage": "40 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Febuxostat 80 mg", "generic": "Febuxostat", "brands": ["Feburic-80", "Zurig-80"], "category": "Stones", "dosage": "80 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Thiazide (HCTZ) 12.5 mg", "generic": "Hydrochlorothiazide", "brands": ["Aquazide", "Hydrozide"], "category": "Stones", "dosage": "12.5 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Thiazide (HCTZ) 25 mg", "generic": "Hydrochlorothiazide", "brands": ["Aquazide-25"], "category": "Stones", "dosage": "25 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Tiopronin 100 mg", "generic": "Tiopronin", "brands": ["Thiola"], "category": "Stones", "dosage": "100 mg", "frequency": "TID", "duration": "90 days", "instructions": "For cystine stones."},
    {"name": "D-Penicillamine 250 mg", "generic": "D-Penicillamine", "brands": ["Cilamine", "Depen"], "category": "Stones", "dosage": "250 mg", "frequency": "QID", "duration": "90 days"},
    {"name": "Sodium Bicarbonate 500 mg", "generic": "Sodium bicarbonate", "brands": ["Sodamint", "Nodosis"], "category": "Stones", "dosage": "500 mg", "frequency": "TID", "duration": "30 days", "instructions": "Alkalinises urine for uric acid stones."},

    # Antispasmodics for colic
    {"name": "Drotaverine 80 mg", "generic": "Drotaverine", "brands": ["Drotin", "Doverin"], "category": "Antispasmodic", "dosage": "80 mg", "frequency": "TID", "duration": "5 days", "timing": "After food"},
    {"name": "Drotaverine 40 mg", "generic": "Drotaverine", "brands": ["Drotin-40"], "category": "Antispasmodic", "dosage": "40 mg", "frequency": "TID", "duration": "5 days"},
    {"name": "Drotaverine + Mefenamic acid", "generic": "Drotaverine+Mefenamic", "brands": ["Meftal-Spas", "Drotin-M"], "category": "Antispasmodic", "dosage": "1 tab", "frequency": "TID", "duration": "5 days"},
    {"name": "Hyoscine butylbromide 10 mg", "generic": "Hyoscine butylbromide", "brands": ["Buscopan", "Buscogast"], "category": "Antispasmodic", "dosage": "10 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Hyoscine butylbromide 20 mg IM", "generic": "Hyoscine butylbromide", "brands": ["Buscopan Inj"], "category": "Antispasmodic", "dosage": "20 mg IM", "frequency": "SOS", "duration": "1 day"},
    {"name": "Dicyclomine 20 mg", "generic": "Dicyclomine", "brands": ["Cyclopam", "Sparinil"], "category": "Antispasmodic", "dosage": "20 mg", "frequency": "TID", "duration": "3 days"},

    # ==================================================================
    # ANTIBIOTICS — URO
    # ==================================================================
    {"name": "Nitrofurantoin 100 mg", "generic": "Nitrofurantoin", "brands": ["Niftas", "Martifur", "Urinorm"], "category": "Antibiotic", "dosage": "100 mg", "frequency": "BID", "duration": "5 days", "timing": "With food", "instructions": "Avoid if CrCl <30."},
    {"name": "Nitrofurantoin MR 100 mg", "generic": "Nitrofurantoin", "brands": ["Niftas MR", "Martifur MR"], "category": "Antibiotic", "dosage": "100 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Nitrofurantoin 50 mg (suppression)", "generic": "Nitrofurantoin", "brands": ["Niftas-50"], "category": "Antibiotic", "dosage": "50 mg", "frequency": "HS", "duration": "90 days", "instructions": "Suppressive dose for recurrent UTI."},
    {"name": "Trimethoprim-Sulfamethoxazole DS", "generic": "TMP-SMX", "brands": ["Bactrim DS", "Septran DS", "Cotrimoxazole"], "category": "Antibiotic", "dosage": "160/800 mg", "frequency": "BID", "duration": "3 days"},
    {"name": "Ciprofloxacin 250 mg", "generic": "Ciprofloxacin", "brands": ["Cifran", "Ciplox", "Ciprobid"], "category": "Antibiotic", "dosage": "250 mg", "frequency": "BID", "duration": "3 days"},
    {"name": "Ciprofloxacin 500 mg", "generic": "Ciprofloxacin", "brands": ["Cifran-500", "Ciplox-500", "Ciprobid-500"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "7 days", "instructions": "Avoid antacids within 2 h."},
    {"name": "Ciprofloxacin 750 mg", "generic": "Ciprofloxacin", "brands": ["Cifran-750", "Ciplox-750"], "category": "Antibiotic", "dosage": "750 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ciprofloxacin 200 mg IV", "generic": "Ciprofloxacin", "brands": ["Cifran IV"], "category": "Antibiotic", "dosage": "200 mg IV", "frequency": "BID", "duration": "5 days"},
    {"name": "Levofloxacin 250 mg", "generic": "Levofloxacin", "brands": ["Levoflox-250", "Lquin-250"], "category": "Antibiotic", "dosage": "250 mg", "frequency": "OD", "duration": "7 days"},
    {"name": "Levofloxacin 500 mg", "generic": "Levofloxacin", "brands": ["Levoflox", "Lquin", "Glevo"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "OD", "duration": "7 days"},
    {"name": "Levofloxacin 750 mg", "generic": "Levofloxacin", "brands": ["Levoflox-750"], "category": "Antibiotic", "dosage": "750 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Norfloxacin 400 mg", "generic": "Norfloxacin", "brands": ["Norflox", "Noroxin", "Uroflox"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ofloxacin 200 mg", "generic": "Ofloxacin", "brands": ["Zanocin", "Oflox"], "category": "Antibiotic", "dosage": "200 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Ofloxacin 400 mg", "generic": "Ofloxacin", "brands": ["Zanocin-400", "Oflox-400"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ofloxacin + Ornidazole", "generic": "Ofloxacin+Ornidazole", "brands": ["O2", "Oflomac-OZ", "Zanocin-OZ"], "category": "Antibiotic", "dosage": "200/500 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Moxifloxacin 400 mg", "generic": "Moxifloxacin", "brands": ["Avelox", "Moxif"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "OD", "duration": "7 days"},
    {"name": "Amoxicillin + Clavulanate 625 mg", "generic": "Amoxy-Clav", "brands": ["Augmentin", "Clavam", "Moxikind-CV"], "category": "Antibiotic", "dosage": "625 mg", "frequency": "TID", "duration": "7 days"},
    {"name": "Amoxicillin + Clavulanate 1 g", "generic": "Amoxy-Clav", "brands": ["Augmentin-1g", "Clavam-1g"], "category": "Antibiotic", "dosage": "1 g", "frequency": "BID", "duration": "7 days"},
    {"name": "Amoxicillin 500 mg", "generic": "Amoxicillin", "brands": ["Novamox", "Mox", "Amoxil"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "TID", "duration": "7 days"},
    {"name": "Cefixime 200 mg", "generic": "Cefixime", "brands": ["Taxim-O", "Zifi", "Cefolac"], "category": "Antibiotic", "dosage": "200 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefixime 400 mg", "generic": "Cefixime", "brands": ["Taxim-O-400", "Zifi-400"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "OD", "duration": "7 days"},
    {"name": "Cefixime + Clavulanate", "generic": "Cefixime+Clavulanate", "brands": ["Zifi-CV", "Taxim-CL"], "category": "Antibiotic", "dosage": "200/125 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefpodoxime 200 mg", "generic": "Cefpodoxime", "brands": ["Cepodem", "Doxcef"], "category": "Antibiotic", "dosage": "200 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefuroxime 500 mg", "generic": "Cefuroxime", "brands": ["Ceftum", "Supacef"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefuroxime 250 mg", "generic": "Cefuroxime", "brands": ["Ceftum-250"], "category": "Antibiotic", "dosage": "250 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ceftriaxone 1 g IV/IM", "generic": "Ceftriaxone", "brands": ["Monocef", "Intacef", "Oframax"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "OD", "duration": "5 days"},
    {"name": "Ceftriaxone 2 g IV", "generic": "Ceftriaxone", "brands": ["Monocef-2g", "Intacef-2g"], "category": "Antibiotic", "dosage": "2 g IV", "frequency": "OD", "duration": "5 days"},
    {"name": "Ceftriaxone + Sulbactam 1.5 g IV", "generic": "Ceftriaxone+Sulbactam", "brands": ["Monocef-SB", "Xone-SB"], "category": "Antibiotic", "dosage": "1.5 g IV", "frequency": "BID", "duration": "5 days"},
    {"name": "Cefoperazone + Sulbactam 1.5 g IV", "generic": "Cefoperazone+Sulbactam", "brands": ["Magnex", "Sulbactam"], "category": "Antibiotic", "dosage": "1.5 g IV", "frequency": "BID", "duration": "7 days"},
    {"name": "Piperacillin + Tazobactam 4.5 g IV", "generic": "Piperacillin+Tazobactam", "brands": ["Zosyn", "Tazar", "Piptaz"], "category": "Antibiotic", "dosage": "4.5 g IV", "frequency": "Q8H", "duration": "7 days"},
    {"name": "Meropenem 1 g IV", "generic": "Meropenem", "brands": ["Meronem", "Merocrit"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "Q8H", "duration": "7 days"},
    {"name": "Imipenem + Cilastatin 500 mg IV", "generic": "Imipenem+Cilastatin", "brands": ["Cilanem", "Primaxin"], "category": "Antibiotic", "dosage": "500 mg IV", "frequency": "Q6H", "duration": "7 days"},
    {"name": "Ertapenem 1 g IV", "generic": "Ertapenem", "brands": ["Invanz"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "OD", "duration": "7 days"},
    {"name": "Amikacin 500 mg IV", "generic": "Amikacin", "brands": ["Mikacin", "Amicin"], "category": "Antibiotic", "dosage": "500 mg IV", "frequency": "BID", "duration": "7 days", "instructions": "Monitor renal function."},
    {"name": "Gentamicin 80 mg IV", "generic": "Gentamicin", "brands": ["Genticyn"], "category": "Antibiotic", "dosage": "80 mg IV", "frequency": "TID", "duration": "5 days"},
    {"name": "Fosfomycin 3 g sachet", "generic": "Fosfomycin", "brands": ["Urifos", "Fosmicin"], "category": "Antibiotic", "dosage": "3 g", "frequency": "Single dose", "duration": "1 day", "timing": "At bedtime", "instructions": "Dissolve in water; avoid food 2 h before/after."},
    {"name": "Doxycycline 100 mg", "generic": "Doxycycline", "brands": ["Doxt", "Doxy-1", "Minicycline"], "category": "Antibiotic", "dosage": "100 mg", "frequency": "BID", "duration": "10 days", "timing": "After food"},
    {"name": "Metronidazole 400 mg", "generic": "Metronidazole", "brands": ["Flagyl", "Metrogyl"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "TID", "duration": "7 days", "instructions": "Avoid alcohol."},
    {"name": "Metronidazole 500 mg IV", "generic": "Metronidazole", "brands": ["Metrogyl IV", "Flagyl IV"], "category": "Antibiotic", "dosage": "500 mg IV", "frequency": "TID", "duration": "5 days"},
    {"name": "Tinidazole 500 mg", "generic": "Tinidazole", "brands": ["Tiniba", "Fasigyn"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Ornidazole 500 mg", "generic": "Ornidazole", "brands": ["Giro", "Ornida"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Azithromycin 500 mg", "generic": "Azithromycin", "brands": ["Azithral", "Zithromax", "Azee"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "OD", "duration": "3 days"},
    {"name": "Azithromycin 250 mg", "generic": "Azithromycin", "brands": ["Azithral-250", "Azee-250"], "category": "Antibiotic", "dosage": "250 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Linezolid 600 mg", "generic": "Linezolid", "brands": ["Lizolid", "Linospan"], "category": "Antibiotic", "dosage": "600 mg", "frequency": "BID", "duration": "10 days"},
    {"name": "Vancomycin 1 g IV", "generic": "Vancomycin", "brands": ["Vancocin", "Vancogen"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "BID", "duration": "7 days", "instructions": "Monitor trough levels."},
    {"name": "Teicoplanin 400 mg IV", "generic": "Teicoplanin", "brands": ["Targocid", "Ticocin"], "category": "Antibiotic", "dosage": "400 mg IV", "frequency": "OD", "duration": "7 days"},
    {"name": "Colistin 1 MIU IV", "generic": "Colistin", "brands": ["Xylistin", "Walomycin"], "category": "Antibiotic", "dosage": "1 MIU IV", "frequency": "Q8H", "duration": "10 days"},
    {"name": "Rifampicin 450 mg", "generic": "Rifampicin", "brands": ["Rifadin", "R-Cin"], "category": "Antibiotic", "dosage": "450 mg", "frequency": "OD", "duration": "TB 6 months", "timing": "Empty stomach"},
    {"name": "INH + Rifampicin + Pyrazinamide + Ethambutol (HRZE FDC)", "generic": "Anti-TB FDC", "brands": ["Akurit-4", "Forecox-4"], "category": "Antibiotic", "dosage": "4 FDC", "frequency": "OD", "duration": "2 months", "timing": "Empty stomach", "instructions": "For genitourinary TB."},

    # ==================================================================
    # ANALGESICS / ANTI-INFLAMMATORY
    # ==================================================================
    {"name": "Paracetamol 500 mg", "generic": "Paracetamol", "brands": ["Crocin", "Dolo-500", "Calpol"], "category": "Analgesic", "dosage": "500 mg", "frequency": "TID", "duration": "5 days", "timing": "After food"},
    {"name": "Paracetamol 650 mg", "generic": "Paracetamol", "brands": ["Dolo-650", "Crocin-650", "Pacimol"], "category": "Analgesic", "dosage": "650 mg", "frequency": "TID", "duration": "5 days", "timing": "After food"},
    {"name": "Paracetamol 1 g IV", "generic": "Paracetamol", "brands": ["Perfalgan", "P-IV"], "category": "Analgesic", "dosage": "1 g IV", "frequency": "Q6H", "duration": "2 days"},
    {"name": "Diclofenac 50 mg", "generic": "Diclofenac", "brands": ["Voveran", "Dynapar", "Voltaren"], "category": "Analgesic", "dosage": "50 mg", "frequency": "BID", "duration": "3 days", "timing": "After food"},
    {"name": "Diclofenac SR 100 mg", "generic": "Diclofenac", "brands": ["Voveran SR", "Dynapar SR"], "category": "Analgesic", "dosage": "100 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Diclofenac 75 mg IM", "generic": "Diclofenac", "brands": ["Voveran Inj"], "category": "Analgesic", "dosage": "75 mg IM", "frequency": "SOS", "duration": "1 day"},
    {"name": "Diclofenac Gel 1%", "generic": "Diclofenac", "brands": ["Voveran Gel", "Dynapar Gel"], "category": "Analgesic", "dosage": "Apply locally", "frequency": "TID", "duration": "7 days"},
    {"name": "Ketorolac 10 mg", "generic": "Ketorolac", "brands": ["Ketorol", "Zofer"], "category": "Analgesic", "dosage": "10 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Ketorolac 30 mg IM/IV", "generic": "Ketorolac", "brands": ["Ketorol DT Inj"], "category": "Analgesic", "dosage": "30 mg IV", "frequency": "SOS", "duration": "2 days"},
    {"name": "Tramadol 50 mg", "generic": "Tramadol", "brands": ["Ultracet", "Contramal", "Tramazac"], "category": "Analgesic", "dosage": "50 mg", "frequency": "TID", "duration": "3 days", "timing": "After food"},
    {"name": "Tramadol 100 mg SR", "generic": "Tramadol", "brands": ["Contramal SR", "Tramazac OD"], "category": "Analgesic", "dosage": "100 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Tramadol + Paracetamol", "generic": "Tramadol+Paracetamol", "brands": ["Ultracet", "Acuvin", "Combiflam-TM"], "category": "Analgesic", "dosage": "37.5/325 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Aceclofenac 100 mg", "generic": "Aceclofenac", "brands": ["Hifenac", "Zerodol", "Aceclo"], "category": "Analgesic", "dosage": "100 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Aceclofenac + Paracetamol", "generic": "Aceclofenac+Paracetamol", "brands": ["Zerodol-P", "Hifenac-P", "Dolokind-A"], "category": "Analgesic", "dosage": "100/325 mg", "frequency": "BID", "duration": "3 days"},
    {"name": "Aceclofenac + Paracetamol + Serratiopeptidase", "generic": "Aceclofenac+PCM+Serratio", "brands": ["Zerodol-SP", "Hifenac-P SP"], "category": "Analgesic", "dosage": "100/325/15 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Ibuprofen 400 mg", "generic": "Ibuprofen", "brands": ["Brufen", "Combiflam"], "category": "Analgesic", "dosage": "400 mg", "frequency": "TID", "duration": "3 days", "timing": "After food"},
    {"name": "Ibuprofen 600 mg", "generic": "Ibuprofen", "brands": ["Brufen-600"], "category": "Analgesic", "dosage": "600 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Ibuprofen + Paracetamol", "generic": "Ibuprofen+Paracetamol", "brands": ["Combiflam", "Ibugesic Plus"], "category": "Analgesic", "dosage": "400/325 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Etoricoxib 60 mg", "generic": "Etoricoxib", "brands": ["Etoshine", "Torvik", "Nucoxia-60"], "category": "Analgesic", "dosage": "60 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Etoricoxib 90 mg", "generic": "Etoricoxib", "brands": ["Etoshine-90", "Nucoxia-90"], "category": "Analgesic", "dosage": "90 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Etoricoxib 120 mg", "generic": "Etoricoxib", "brands": ["Nucoxia-120"], "category": "Analgesic", "dosage": "120 mg", "frequency": "OD", "duration": "3 days", "instructions": "Acute renal colic; do not exceed 8 days."},
    {"name": "Celecoxib 200 mg", "generic": "Celecoxib", "brands": ["Celact", "Cobix"], "category": "Analgesic", "dosage": "200 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Mefenamic acid 500 mg", "generic": "Mefenamic acid", "brands": ["Meftal", "Ponstan"], "category": "Analgesic", "dosage": "500 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Nimesulide 100 mg", "generic": "Nimesulide", "brands": ["Nise", "Nimulid"], "category": "Analgesic", "dosage": "100 mg", "frequency": "BID", "duration": "3 days"},

    # Opioids (post-op)
    {"name": "Morphine 10 mg IV/IM", "generic": "Morphine", "brands": ["Morcontin"], "category": "Analgesic", "dosage": "10 mg", "frequency": "Q4H", "duration": "2 days", "instructions": "Severe post-op pain; monitor resp rate."},
    {"name": "Fentanyl 50 mcg IV", "generic": "Fentanyl", "brands": ["Fenstud"], "category": "Analgesic", "dosage": "50 mcg IV", "frequency": "SOS", "duration": "1 day"},
    {"name": "Buprenorphine 0.2 mg SL", "generic": "Buprenorphine", "brands": ["Tidigesic"], "category": "Analgesic", "dosage": "0.2 mg SL", "frequency": "Q6H", "duration": "2 days"},

    # ==================================================================
    # GI / PPI / ANTI-EMETIC / LAXATIVES
    # ==================================================================
    {"name": "Pantoprazole 40 mg", "generic": "Pantoprazole", "brands": ["Pantocid", "Pan-40", "Pantop"], "category": "PPI / GI", "dosage": "40 mg", "frequency": "OD", "duration": "14 days", "timing": "Before breakfast"},
    {"name": "Pantoprazole 40 mg IV", "generic": "Pantoprazole", "brands": ["Pantocid IV"], "category": "PPI / GI", "dosage": "40 mg IV", "frequency": "OD", "duration": "3 days"},
    {"name": "Rabeprazole 20 mg", "generic": "Rabeprazole", "brands": ["Razo", "Rablet", "Veloz-20"], "category": "PPI / GI", "dosage": "20 mg", "frequency": "OD", "duration": "14 days", "timing": "Before breakfast"},
    {"name": "Esomeprazole 40 mg", "generic": "Esomeprazole", "brands": ["Nexpro", "Esoz"], "category": "PPI / GI", "dosage": "40 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Omeprazole 20 mg", "generic": "Omeprazole", "brands": ["Omez", "Ocid"], "category": "PPI / GI", "dosage": "20 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Rabeprazole + Domperidone", "generic": "Rabeprazole+Domperidone", "brands": ["Razo-D", "Rablet-D", "Veloz-D"], "category": "PPI / GI", "dosage": "20/10 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Pantoprazole + Domperidone", "generic": "Pantoprazole+Domperidone", "brands": ["Pantocid-DSR", "Pan-D"], "category": "PPI / GI", "dosage": "40/30 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Ondansetron 4 mg", "generic": "Ondansetron", "brands": ["Emeset", "Vomikind", "Zofer"], "category": "PPI / GI", "dosage": "4 mg", "frequency": "TID", "duration": "2 days"},
    {"name": "Ondansetron 8 mg IV", "generic": "Ondansetron", "brands": ["Emeset IV", "Zofer IV"], "category": "PPI / GI", "dosage": "8 mg IV", "frequency": "Q8H", "duration": "2 days"},
    {"name": "Metoclopramide 10 mg", "generic": "Metoclopramide", "brands": ["Perinorm", "Reglan"], "category": "PPI / GI", "dosage": "10 mg", "frequency": "TID", "duration": "2 days"},
    {"name": "Domperidone 10 mg", "generic": "Domperidone", "brands": ["Domstal", "Motilium"], "category": "PPI / GI", "dosage": "10 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Lactulose 15 ml", "generic": "Lactulose", "brands": ["Duphalac", "Looz", "Lactifiber"], "category": "Laxative", "dosage": "15 ml", "frequency": "HS", "duration": "5 days", "instructions": "Adjust dose for soft stool."},
    {"name": "Ispaghula husk 5 g", "generic": "Ispaghula", "brands": ["Isabgol", "Naturolax", "Fybogel"], "category": "Laxative", "dosage": "5 g", "frequency": "HS", "duration": "30 days", "instructions": "Take with a full glass of water."},
    {"name": "Polyethylene Glycol 17 g", "generic": "PEG 3350", "brands": ["Peglec", "Cremalax"], "category": "Laxative", "dosage": "17 g", "frequency": "OD", "duration": "7 days"},
    {"name": "Bisacodyl 5 mg", "generic": "Bisacodyl", "brands": ["Dulcolax", "Cremalax-B"], "category": "Laxative", "dosage": "5-10 mg", "frequency": "HS", "duration": "3 days"},
    {"name": "Senna + Docusate", "generic": "Senna+Docusate", "brands": ["Cremalax", "Softovac"], "category": "Laxative", "dosage": "1 tab", "frequency": "HS", "duration": "7 days"},
    {"name": "Glycerin enema", "generic": "Glycerin", "brands": ["Glychek", "Glycerol Enema"], "category": "Laxative", "dosage": "PR 30 ml", "frequency": "SOS", "duration": "1 day"},

    # ==================================================================
    # ERECTILE DYSFUNCTION / PDE-5 & ANDROGENS
    # ==================================================================
    {"name": "Sildenafil 25 mg", "generic": "Sildenafil", "brands": ["Suhagra-25", "Penegra-25"], "category": "ED", "dosage": "25 mg", "frequency": "SOS", "duration": "PRN", "instructions": "Start low in elderly / renal impairment."},
    {"name": "Sildenafil 50 mg", "generic": "Sildenafil", "brands": ["Suhagra", "Penegra", "Caverta"], "category": "ED", "dosage": "50 mg", "frequency": "SOS", "duration": "PRN", "instructions": "1 h before activity; avoid nitrates."},
    {"name": "Sildenafil 100 mg", "generic": "Sildenafil", "brands": ["Suhagra-100", "Penegra-100", "Manforce-100"], "category": "ED", "dosage": "100 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Tadalafil 10 mg", "generic": "Tadalafil", "brands": ["Tadacip-10", "Megalis-10", "Forzest-10"], "category": "ED", "dosage": "10 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Tadalafil 20 mg", "generic": "Tadalafil", "brands": ["Tadacip-20", "Megalis-20", "Forzest-20"], "category": "ED", "dosage": "20 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Tadalafil 2.5 mg (daily)", "generic": "Tadalafil", "brands": ["Tadacip-2.5", "Megalis-2.5"], "category": "ED", "dosage": "2.5 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Vardenafil 10 mg", "generic": "Vardenafil", "brands": ["Vilitra", "Valif"], "category": "ED", "dosage": "10 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Vardenafil 20 mg", "generic": "Vardenafil", "brands": ["Vilitra-20"], "category": "ED", "dosage": "20 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Avanafil 100 mg", "generic": "Avanafil", "brands": ["Stendra", "Avana"], "category": "ED", "dosage": "100 mg", "frequency": "SOS", "duration": "PRN", "instructions": "Fastest onset PDE5 (15-30 min)."},
    {"name": "Avanafil 200 mg", "generic": "Avanafil", "brands": ["Stendra-200"], "category": "ED", "dosage": "200 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Dapoxetine 30 mg", "generic": "Dapoxetine", "brands": ["Priligy", "Duralast-30"], "category": "Sexual health", "dosage": "30 mg", "frequency": "SOS", "duration": "PRN", "instructions": "1-3 h before activity; max once daily."},
    {"name": "Dapoxetine 60 mg", "generic": "Dapoxetine", "brands": ["Priligy-60", "Duralast-60"], "category": "Sexual health", "dosage": "60 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Sildenafil + Dapoxetine", "generic": "Sildenafil+Dapoxetine", "brands": ["Super P-Force", "Duralast"], "category": "Sexual health", "dosage": "100/60 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Alprostadil intraurethral 500 mcg", "generic": "Alprostadil", "brands": ["MUSE"], "category": "ED", "dosage": "500 mcg intraurethral", "frequency": "SOS", "duration": "PRN"},
    {"name": "Alprostadil intracavernosal 10 mcg", "generic": "Alprostadil", "brands": ["Caverject"], "category": "ED", "dosage": "10 mcg IC", "frequency": "SOS", "duration": "PRN"},

    # Androgens
    {"name": "Testosterone Undecanoate 40 mg", "generic": "Testosterone", "brands": ["Andriol Testocaps", "Cernos Caps"], "category": "Androgen", "dosage": "40 mg", "frequency": "BID", "duration": "30 days", "instructions": "Monitor PSA & hematocrit."},
    {"name": "Testosterone Undecanoate 250 mg IM", "generic": "Testosterone", "brands": ["Nebido", "Sustanon-250"], "category": "Androgen", "dosage": "250 mg IM", "frequency": "Every 10-12 wks", "duration": "PRN"},
    {"name": "Testosterone gel 1%", "generic": "Testosterone", "brands": ["Androgel", "Cernos Gel", "Axiron"], "category": "Androgen", "dosage": "5 g gel", "frequency": "OD", "duration": "30 days", "timing": "Morning"},
    {"name": "Clomiphene citrate 25 mg", "generic": "Clomiphene", "brands": ["Clomid", "Fertomid-25"], "category": "Androgen", "dosage": "25 mg", "frequency": "OD", "duration": "90 days", "instructions": "Off-label male hypogonadism."},
    {"name": "hCG 5000 IU IM", "generic": "hCG", "brands": ["HuCoG", "Pregnyl"], "category": "Androgen", "dosage": "5000 IU IM", "frequency": "Weekly", "duration": "30 days"},
    {"name": "Finasteride 5 mg (off-label female)", "generic": "Finasteride", "brands": ["Finast"], "category": "Androgen", "dosage": "5 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Dihydrotestosterone gel 2.5%", "generic": "DHT", "brands": ["Andractim"], "category": "Androgen", "dosage": "5 g", "frequency": "OD", "duration": "30 days"},

    # ==================================================================
    # KIDNEY / CKD / DIURETICS / ELECTROLYTES
    # ==================================================================
    {"name": "Furosemide 40 mg", "generic": "Furosemide", "brands": ["Lasix", "Frusenex"], "category": "Diuretic", "dosage": "40 mg", "frequency": "OD", "duration": "7 days", "timing": "Morning"},
    {"name": "Furosemide 20 mg IV", "generic": "Furosemide", "brands": ["Lasix Inj"], "category": "Diuretic", "dosage": "20 mg IV", "frequency": "BID", "duration": "3 days"},
    {"name": "Torsemide 10 mg", "generic": "Torsemide", "brands": ["Dytor", "Torax"], "category": "Diuretic", "dosage": "10 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Torsemide 20 mg", "generic": "Torsemide", "brands": ["Dytor-20", "Torax-20"], "category": "Diuretic", "dosage": "20 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Spironolactone 25 mg", "generic": "Spironolactone", "brands": ["Aldactone", "Spirix"], "category": "Diuretic", "dosage": "25 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Spironolactone 50 mg", "generic": "Spironolactone", "brands": ["Aldactone-50"], "category": "Diuretic", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Eplerenone 25 mg", "generic": "Eplerenone", "brands": ["Eptus", "Inspra"], "category": "Diuretic", "dosage": "25 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Mannitol 20% IV", "generic": "Mannitol", "brands": ["Mannidex"], "category": "Diuretic", "dosage": "250 ml IV", "frequency": "SOS", "duration": "1 day", "instructions": "For forced diuresis / cerebral oedema."},
    {"name": "Sodium Chloride 0.9% 500 ml IV", "generic": "Normal saline", "brands": ["NS"], "category": "Electrolytes", "dosage": "500 ml IV", "frequency": "OD-TID", "duration": "PRN"},
    {"name": "Ringer Lactate 500 ml IV", "generic": "RL", "brands": ["RL"], "category": "Electrolytes", "dosage": "500 ml IV", "frequency": "OD-TID", "duration": "PRN"},
    {"name": "DNS 500 ml IV", "generic": "DNS", "brands": ["DNS"], "category": "Electrolytes", "dosage": "500 ml IV", "frequency": "OD-BID", "duration": "PRN"},
    {"name": "Dextrose 5% 500 ml IV", "generic": "D5W", "brands": ["D5"], "category": "Electrolytes", "dosage": "500 ml IV", "frequency": "OD-BID", "duration": "PRN"},
    {"name": "Calcium Gluconate 10 ml IV", "generic": "Calcium gluconate", "brands": ["Calcigen"], "category": "Electrolytes", "dosage": "10 ml IV", "frequency": "OD", "duration": "PRN", "instructions": "For hyperkalaemia / hypocalcaemia."},
    {"name": "Potassium Chloride 20 mEq IV", "generic": "KCl", "brands": ["KCl IV"], "category": "Electrolytes", "dosage": "20 mEq IV", "frequency": "SOS", "duration": "PRN", "instructions": "Infuse slowly; monitor ECG."},
    {"name": "Insulin + Dextrose (hyperkalaemia)", "generic": "Regular insulin + D25", "brands": ["Actrapid + D25"], "category": "Electrolytes", "dosage": "10 U R-insulin + 50 ml D25", "frequency": "SOS", "duration": "PRN"},
    {"name": "Calcium Polystyrene Sulfonate 15 g", "generic": "Ca-polystyrene", "brands": ["Kayexalate", "Sorbisterit"], "category": "Electrolytes", "dosage": "15 g", "frequency": "TID", "duration": "5 days", "instructions": "For chronic hyperkalaemia."},

    # CKD support
    {"name": "Iron Sucrose 100 mg IV", "generic": "Iron sucrose", "brands": ["Orofer-S", "Fericip"], "category": "Hematinic", "dosage": "100 mg IV", "frequency": "Weekly x 5", "duration": "PRN"},
    {"name": "Ferric Carboxymaltose 500 mg IV", "generic": "FCM", "brands": ["Emfer", "Ferinject"], "category": "Hematinic", "dosage": "500 mg IV", "frequency": "Single", "duration": "1 day"},
    {"name": "Ferrous Ascorbate 100 mg", "generic": "Fe ascorbate", "brands": ["Orofer-XT", "Livogen-Z"], "category": "Hematinic", "dosage": "100 mg", "frequency": "OD", "duration": "60 days", "timing": "After food"},
    {"name": "Erythropoietin 4000 IU SC", "generic": "Erythropoietin", "brands": ["Eprex", "Vintor-4000"], "category": "Hematinic", "dosage": "4000 IU SC", "frequency": "Weekly", "duration": "PRN"},
    {"name": "Darbepoetin 40 mcg SC", "generic": "Darbepoetin", "brands": ["Cresp"], "category": "Hematinic", "dosage": "40 mcg SC", "frequency": "Fortnightly", "duration": "PRN"},
    {"name": "Cinacalcet 30 mg", "generic": "Cinacalcet", "brands": ["Sensipar", "Cinacal"], "category": "CKD-MBD", "dosage": "30 mg", "frequency": "OD", "duration": "30 days", "instructions": "For secondary hyperparathyroidism."},
    {"name": "Calcitriol 0.25 mcg", "generic": "Calcitriol", "brands": ["Rocaltrol", "Calcirol"], "category": "CKD-MBD", "dosage": "0.25 mcg", "frequency": "OD", "duration": "30 days"},
    {"name": "Sevelamer 800 mg", "generic": "Sevelamer carbonate", "brands": ["Renvela", "Seviplus"], "category": "CKD-MBD", "dosage": "800 mg", "frequency": "TID", "duration": "30 days", "timing": "With meals"},
    {"name": "Lanthanum 500 mg", "generic": "Lanthanum carbonate", "brands": ["Fosrenol"], "category": "CKD-MBD", "dosage": "500 mg", "frequency": "TID", "duration": "30 days", "timing": "With meals"},
    {"name": "Calcium Carbonate 500 mg", "generic": "Calcium carbonate", "brands": ["Shelcal-500", "Calcimax-P"], "category": "CKD-MBD", "dosage": "500 mg", "frequency": "TID", "duration": "30 days", "timing": "With meals"},
    {"name": "Calcium + Vit D3", "generic": "Ca+D3", "brands": ["Shelcal", "Calcimax", "Ostocalcium"], "category": "CKD-MBD", "dosage": "500/250 IU", "frequency": "BID", "duration": "30 days"},
    {"name": "Cholecalciferol 60000 IU", "generic": "Vitamin D3", "brands": ["Uprise D3", "Arachitol Nano"], "category": "CKD-MBD", "dosage": "60000 IU", "frequency": "Weekly x 8", "duration": "2 months"},

    # ==================================================================
    # TRANSPLANT / IMMUNOSUPPRESSANTS
    # ==================================================================
    {"name": "Tacrolimus 1 mg", "generic": "Tacrolimus", "brands": ["Pangraf", "Tacrograf", "Prograf"], "category": "Immunosuppressant", "dosage": "1 mg", "frequency": "BID", "duration": "30 days", "instructions": "Trough level monitoring."},
    {"name": "Tacrolimus 0.5 mg", "generic": "Tacrolimus", "brands": ["Pangraf-0.5"], "category": "Immunosuppressant", "dosage": "0.5 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Tacrolimus ER 1 mg", "generic": "Tacrolimus ER", "brands": ["Advagraf", "Tacrograf-XL"], "category": "Immunosuppressant", "dosage": "1 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Cyclosporine 100 mg", "generic": "Cyclosporine", "brands": ["Sandimmun", "Panimun Bioral"], "category": "Immunosuppressant", "dosage": "100 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Mycophenolate Mofetil 500 mg", "generic": "Mycophenolate mofetil", "brands": ["CellCept", "Mycept", "Mofilet"], "category": "Immunosuppressant", "dosage": "500 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Mycophenolate Sodium 360 mg", "generic": "Mycophenolate sodium", "brands": ["Myfortic"], "category": "Immunosuppressant", "dosage": "360 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Azathioprine 50 mg", "generic": "Azathioprine", "brands": ["Imuran", "Azoran"], "category": "Immunosuppressant", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Prednisolone 5 mg", "generic": "Prednisolone", "brands": ["Wysolone-5", "Omnacortil-5"], "category": "Immunosuppressant", "dosage": "5 mg", "frequency": "OD", "duration": "30 days", "timing": "Morning after food"},
    {"name": "Prednisolone 10 mg", "generic": "Prednisolone", "brands": ["Wysolone-10", "Omnacortil-10"], "category": "Immunosuppressant", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Methylprednisolone 500 mg IV pulse", "generic": "Methylprednisolone", "brands": ["Solu-Medrol"], "category": "Immunosuppressant", "dosage": "500 mg IV", "frequency": "OD x 3", "duration": "3 days", "instructions": "For acute rejection."},
    {"name": "Basiliximab 20 mg IV", "generic": "Basiliximab", "brands": ["Simulect"], "category": "Immunosuppressant", "dosage": "20 mg IV", "frequency": "Day 0, Day 4", "duration": "Induction"},
    {"name": "ATG 1.5 mg/kg IV", "generic": "Anti-thymocyte globulin", "brands": ["Thymoglobulin", "Grafalon"], "category": "Immunosuppressant", "dosage": "1.5 mg/kg IV", "frequency": "OD", "duration": "5 days"},
    {"name": "Rituximab 500 mg IV", "generic": "Rituximab", "brands": ["Mabthera", "Reditux"], "category": "Immunosuppressant", "dosage": "500 mg IV", "frequency": "Weekly x 4", "duration": "Induction"},
    {"name": "Sirolimus 1 mg", "generic": "Sirolimus", "brands": ["Rapamune", "Siromus"], "category": "Immunosuppressant", "dosage": "1 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Everolimus 0.5 mg", "generic": "Everolimus", "brands": ["Certican", "Evertor"], "category": "Immunosuppressant", "dosage": "0.5 mg", "frequency": "BID", "duration": "30 days"},

    # Antivirals
    {"name": "Valganciclovir 450 mg", "generic": "Valganciclovir", "brands": ["Valcyte", "Valgan"], "category": "Antiviral", "dosage": "450 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Ganciclovir 500 mg IV", "generic": "Ganciclovir", "brands": ["Cytovene"], "category": "Antiviral", "dosage": "500 mg IV", "frequency": "BID", "duration": "14 days"},
    {"name": "Valacyclovir 500 mg", "generic": "Valacyclovir", "brands": ["Valtrex", "Valcivir"], "category": "Antiviral", "dosage": "500 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Acyclovir 400 mg", "generic": "Acyclovir", "brands": ["Zovirax", "Herpex"], "category": "Antiviral", "dosage": "400 mg", "frequency": "5x/day", "duration": "7 days"},
    {"name": "Oseltamivir 75 mg", "generic": "Oseltamivir", "brands": ["Tamiflu", "Fluvir"], "category": "Antiviral", "dosage": "75 mg", "frequency": "BID", "duration": "5 days"},

    # Antifungals
    {"name": "Fluconazole 150 mg", "generic": "Fluconazole", "brands": ["Forcan", "Zocon", "Syscan"], "category": "Antifungal", "dosage": "150 mg", "frequency": "Single dose", "duration": "1 day"},
    {"name": "Fluconazole 200 mg", "generic": "Fluconazole", "brands": ["Forcan-200"], "category": "Antifungal", "dosage": "200 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Itraconazole 100 mg", "generic": "Itraconazole", "brands": ["Itral", "Canditral"], "category": "Antifungal", "dosage": "100 mg", "frequency": "BID", "duration": "14 days"},
    {"name": "Voriconazole 200 mg", "generic": "Voriconazole", "brands": ["Vfend", "Voritek"], "category": "Antifungal", "dosage": "200 mg", "frequency": "BID", "duration": "14 days"},

    # ==================================================================
    # ANTI-COAGULANTS / ANTI-PLATELETS
    # ==================================================================
    {"name": "Enoxaparin 40 mg SC", "generic": "Enoxaparin", "brands": ["Clexane", "Lomoh-40"], "category": "Anticoagulant", "dosage": "40 mg SC", "frequency": "OD", "duration": "7 days", "instructions": "Post-op DVT prophylaxis."},
    {"name": "Enoxaparin 60 mg SC", "generic": "Enoxaparin", "brands": ["Clexane-60", "Lomoh-60"], "category": "Anticoagulant", "dosage": "60 mg SC", "frequency": "BID", "duration": "10 days"},
    {"name": "Heparin 5000 IU SC", "generic": "Heparin", "brands": ["Heparin Inj"], "category": "Anticoagulant", "dosage": "5000 IU SC", "frequency": "BID", "duration": "7 days"},
    {"name": "Rivaroxaban 10 mg", "generic": "Rivaroxaban", "brands": ["Xarelto-10"], "category": "Anticoagulant", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Rivaroxaban 20 mg", "generic": "Rivaroxaban", "brands": ["Xarelto-20"], "category": "Anticoagulant", "dosage": "20 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Apixaban 2.5 mg", "generic": "Apixaban", "brands": ["Eliquis-2.5"], "category": "Anticoagulant", "dosage": "2.5 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Apixaban 5 mg", "generic": "Apixaban", "brands": ["Eliquis-5"], "category": "Anticoagulant", "dosage": "5 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Dabigatran 150 mg", "generic": "Dabigatran", "brands": ["Pradaxa"], "category": "Anticoagulant", "dosage": "150 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Warfarin 5 mg", "generic": "Warfarin", "brands": ["Warf", "Uniwarfin"], "category": "Anticoagulant", "dosage": "5 mg", "frequency": "OD", "duration": "30 days", "instructions": "Monitor INR."},
    {"name": "Warfarin 1 mg", "generic": "Warfarin", "brands": ["Warf-1", "Uniwarfin-1"], "category": "Anticoagulant", "dosage": "1 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Aspirin 75 mg", "generic": "Aspirin", "brands": ["Ecosprin-75", "Sprin-75"], "category": "Antiplatelet", "dosage": "75 mg", "frequency": "OD", "duration": "30 days", "timing": "After food"},
    {"name": "Aspirin 150 mg", "generic": "Aspirin", "brands": ["Ecosprin-150"], "category": "Antiplatelet", "dosage": "150 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Clopidogrel 75 mg", "generic": "Clopidogrel", "brands": ["Clopilet", "Deplatt"], "category": "Antiplatelet", "dosage": "75 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Clopidogrel + Aspirin", "generic": "Clopidogrel+Aspirin", "brands": ["Clopitab-A", "Deplatt-A-75"], "category": "Antiplatelet", "dosage": "75/75 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Tranexamic acid 500 mg", "generic": "Tranexamic acid", "brands": ["Trapic", "Pause", "Hemitrex"], "category": "Haemostatic", "dosage": "500 mg", "frequency": "TID", "duration": "5 days", "instructions": "For haematuria / bleeding."},
    {"name": "Tranexamic acid 500 mg IV", "generic": "Tranexamic acid", "brands": ["Trapic Inj"], "category": "Haemostatic", "dosage": "500 mg IV", "frequency": "TID", "duration": "3 days"},
    {"name": "Etamsylate 500 mg", "generic": "Etamsylate", "brands": ["Ethamsyl", "Dicynene"], "category": "Haemostatic", "dosage": "500 mg", "frequency": "TID", "duration": "5 days"},

    # ==================================================================
    # URO-ONCOLOGY
    # ==================================================================
    {"name": "Bicalutamide 50 mg", "generic": "Bicalutamide", "brands": ["Calutide", "Casodex"], "category": "Oncology (Hormone)", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Bicalutamide 150 mg", "generic": "Bicalutamide", "brands": ["Calutide-150", "Casodex-150"], "category": "Oncology (Hormone)", "dosage": "150 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Flutamide 250 mg", "generic": "Flutamide", "brands": ["Flutide", "Cytomid"], "category": "Oncology (Hormone)", "dosage": "250 mg", "frequency": "TID", "duration": "30 days"},
    {"name": "Leuprolide 11.25 mg depot", "generic": "Leuprolide", "brands": ["Lupride-Depot", "Lucrin"], "category": "Oncology (Hormone)", "dosage": "11.25 mg SC", "frequency": "Every 3 months", "duration": "PRN"},
    {"name": "Leuprolide 22.5 mg depot", "generic": "Leuprolide", "brands": ["Lupride-Depot 22.5"], "category": "Oncology (Hormone)", "dosage": "22.5 mg SC", "frequency": "Every 6 months", "duration": "PRN"},
    {"name": "Leuprolide 3.75 mg", "generic": "Leuprolide", "brands": ["Lupride-3.75"], "category": "Oncology (Hormone)", "dosage": "3.75 mg SC", "frequency": "Every 4 weeks", "duration": "PRN"},
    {"name": "Goserelin 3.6 mg depot", "generic": "Goserelin", "brands": ["Zoladex-3.6"], "category": "Oncology (Hormone)", "dosage": "3.6 mg SC", "frequency": "Every 4 weeks", "duration": "PRN"},
    {"name": "Goserelin 10.8 mg depot", "generic": "Goserelin", "brands": ["Zoladex-10.8"], "category": "Oncology (Hormone)", "dosage": "10.8 mg SC", "frequency": "Every 12 weeks", "duration": "PRN"},
    {"name": "Degarelix 80 mg SC", "generic": "Degarelix", "brands": ["Firmagon"], "category": "Oncology (Hormone)", "dosage": "80 mg SC", "frequency": "Monthly", "duration": "PRN", "instructions": "Loading 240 mg first dose."},
    {"name": "Triptorelin 3.75 mg depot", "generic": "Triptorelin", "brands": ["Decapeptyl"], "category": "Oncology (Hormone)", "dosage": "3.75 mg SC", "frequency": "Every 4 weeks", "duration": "PRN"},
    {"name": "Enzalutamide 40 mg", "generic": "Enzalutamide", "brands": ["Xtandi", "Enzamide"], "category": "Oncology (Hormone)", "dosage": "40 mg", "frequency": "QID (=160 mg OD)", "duration": "30 days"},
    {"name": "Enzalutamide 160 mg", "generic": "Enzalutamide", "brands": ["Xtandi-160"], "category": "Oncology (Hormone)", "dosage": "160 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Abiraterone 250 mg", "generic": "Abiraterone", "brands": ["Zytiga", "Abretone"], "category": "Oncology (Hormone)", "dosage": "250 mg", "frequency": "QID (1000 mg OD)", "duration": "30 days", "timing": "Empty stomach"},
    {"name": "Abiraterone 500 mg", "generic": "Abiraterone", "brands": ["Zytiga-500"], "category": "Oncology (Hormone)", "dosage": "500 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Apalutamide 60 mg", "generic": "Apalutamide", "brands": ["Erleada"], "category": "Oncology (Hormone)", "dosage": "60 mg", "frequency": "QID (240 mg OD)", "duration": "30 days"},
    {"name": "Darolutamide 300 mg", "generic": "Darolutamide", "brands": ["Nubeqa"], "category": "Oncology (Hormone)", "dosage": "300 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Docetaxel 75 mg/m² IV", "generic": "Docetaxel", "brands": ["Taxotere", "Docefrez"], "category": "Oncology (Chemo)", "dosage": "75 mg/m² IV", "frequency": "Every 3 weeks", "duration": "6 cycles"},
    {"name": "Cabazitaxel 25 mg/m² IV", "generic": "Cabazitaxel", "brands": ["Jevtana"], "category": "Oncology (Chemo)", "dosage": "25 mg/m² IV", "frequency": "Every 3 weeks", "duration": "10 cycles"},

    # Intravesical / Local
    {"name": "BCG intravesical 81 mg", "generic": "BCG", "brands": ["ImmuCyst", "Pacis BCG"], "category": "Oncology (Intravesical)", "dosage": "81 mg intravesical", "frequency": "Weekly x 6", "duration": "Induction"},
    {"name": "Mitomycin C 40 mg intravesical", "generic": "Mitomycin C", "brands": ["Mitomycin-C"], "category": "Oncology (Intravesical)", "dosage": "40 mg intravesical", "frequency": "Single / Weekly", "duration": "PRN"},
    {"name": "Gemcitabine 1 g intravesical", "generic": "Gemcitabine", "brands": ["Gemcite"], "category": "Oncology (Intravesical)", "dosage": "1 g intravesical", "frequency": "Weekly x 6", "duration": "Induction"},
    {"name": "Gemcitabine 1 g/m² IV", "generic": "Gemcitabine", "brands": ["Gemcite IV"], "category": "Oncology (Chemo)", "dosage": "1000 mg/m² IV", "frequency": "Day 1, 8, 15", "duration": "4 cycles"},
    {"name": "Cisplatin 70 mg/m² IV", "generic": "Cisplatin", "brands": ["Cisplatin"], "category": "Oncology (Chemo)", "dosage": "70 mg/m² IV", "frequency": "Every 3 weeks", "duration": "4 cycles", "instructions": "Pre-hydrate; monitor renal function."},
    {"name": "Sunitinib 50 mg", "generic": "Sunitinib", "brands": ["Sutent", "Sunitix"], "category": "Oncology (TKI)", "dosage": "50 mg", "frequency": "OD (4 wk on, 2 wk off)", "duration": "6 cycles", "instructions": "For RCC."},
    {"name": "Pazopanib 400 mg", "generic": "Pazopanib", "brands": ["Votrient", "Pazotin"], "category": "Oncology (TKI)", "dosage": "400 mg", "frequency": "OD (total 800 mg)", "duration": "30 days"},
    {"name": "Cabozantinib 40 mg", "generic": "Cabozantinib", "brands": ["Cabometyx", "Cometriq"], "category": "Oncology (TKI)", "dosage": "40 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Everolimus 10 mg (RCC)", "generic": "Everolimus", "brands": ["Afinitor"], "category": "Oncology (TKI)", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Nivolumab 240 mg IV", "generic": "Nivolumab", "brands": ["Opdyta", "Opdivo"], "category": "Oncology (IO)", "dosage": "240 mg IV", "frequency": "Every 2 weeks", "duration": "PRN"},
    {"name": "Pembrolizumab 200 mg IV", "generic": "Pembrolizumab", "brands": ["Keytruda"], "category": "Oncology (IO)", "dosage": "200 mg IV", "frequency": "Every 3 weeks", "duration": "PRN"},

    # ==================================================================
    # SYMPTOMATIC / MISC UROLOGY
    # ==================================================================
    {"name": "Phenazopyridine 200 mg", "generic": "Phenazopyridine", "brands": ["Pyridium", "Urex"], "category": "Symptomatic", "dosage": "200 mg", "frequency": "TID", "duration": "2 days", "instructions": "Orange urine is normal; do not exceed 48 h."},
    {"name": "Phenazopyridine 100 mg", "generic": "Phenazopyridine", "brands": ["Pyridium-100"], "category": "Symptomatic", "dosage": "100 mg", "frequency": "TID", "duration": "2 days"},
    {"name": "Oxybutynin instillation 5 mg", "generic": "Oxybutynin", "brands": ["Oxyspas"], "category": "Symptomatic", "dosage": "5 mg intravesical", "frequency": "OD", "duration": "14 days", "instructions": "For interstitial cystitis."},
    {"name": "DMSO 50% intravesical", "generic": "DMSO", "brands": ["Rimso-50"], "category": "Symptomatic", "dosage": "50 ml intravesical", "frequency": "Weekly x 6", "duration": "Induction"},
    {"name": "Pentosan Polysulfate 100 mg", "generic": "Pentosan polysulfate", "brands": ["Elmiron"], "category": "Symptomatic", "dosage": "100 mg", "frequency": "TID", "duration": "90 days", "instructions": "For interstitial cystitis."},
    {"name": "Lignocaine jelly 2%", "generic": "Lignocaine", "brands": ["Xylocaine Jelly", "Wokaine Gel"], "category": "Symptomatic", "dosage": "10 ml urethral", "frequency": "Pre-catheter", "duration": "PRN"},
    {"name": "Chlorhexidine 0.02%", "generic": "Chlorhexidine", "brands": ["Uroplus", "Savlon"], "category": "Symptomatic", "dosage": "200 ml bladder wash", "frequency": "OD", "duration": "3 days"},

    # Estrogen (female urology)
    {"name": "Estradiol vaginal cream 0.01%", "generic": "Estradiol", "brands": ["Evalon", "Progynova cream"], "category": "Female urology", "dosage": "0.5 g intravaginal", "frequency": "Alternate nights", "duration": "30 days"},
    {"name": "Estradiol vaginal ring", "generic": "Estradiol", "brands": ["Estring"], "category": "Female urology", "dosage": "2 mg ring", "frequency": "Every 90 days", "duration": "PRN"},
    {"name": "Duloxetine 20 mg", "generic": "Duloxetine", "brands": ["Duzela", "Duvanta"], "category": "Female urology", "dosage": "20 mg", "frequency": "OD", "duration": "30 days", "instructions": "Stress incontinence in women."},
    {"name": "Duloxetine 40 mg", "generic": "Duloxetine", "brands": ["Duzela-40"], "category": "Female urology", "dosage": "40 mg", "frequency": "BID", "duration": "30 days"},

    # ==================================================================
    # HERBAL / AYURVEDIC / SUPPLEMENTS (popular in Indian practice)
    # ==================================================================
    {"name": "Cystone tablet", "generic": "Polyherbal (stone)", "brands": ["Himalaya Cystone"], "category": "Herbal/Ayurveda", "dosage": "2 tab", "frequency": "BID", "duration": "60 days", "timing": "After food", "instructions": "Supportive therapy for stones / UTI."},
    {"name": "Cystone syrup 10 ml", "generic": "Polyherbal (stone)", "brands": ["Himalaya Cystone Syrup"], "category": "Herbal/Ayurveda", "dosage": "10 ml", "frequency": "BID", "duration": "30 days"},
    {"name": "Himplasia", "generic": "Tribulus + Caesalpinia", "brands": ["Himalaya Himplasia"], "category": "Herbal/Ayurveda", "dosage": "1 tab", "frequency": "BID", "duration": "60 days", "instructions": "BPH adjunct."},
    {"name": "Neeri KFT", "generic": "Polyherbal (kidney)", "brands": ["Aimil Neeri KFT"], "category": "Herbal/Ayurveda", "dosage": "10 ml", "frequency": "BID", "duration": "30 days"},
    {"name": "Neeri tablet", "generic": "Polyherbal (kidney)", "brands": ["Aimil Neeri"], "category": "Herbal/Ayurveda", "dosage": "2 tab", "frequency": "TID", "duration": "30 days"},
    {"name": "Chandraprabha vati", "generic": "Ayurvedic classical", "brands": ["Patanjali", "Baidyanath"], "category": "Herbal/Ayurveda", "dosage": "2 tab", "frequency": "TID", "duration": "30 days", "timing": "After food"},
    {"name": "Gokshur (Tribulus terrestris)", "generic": "Tribulus terrestris", "brands": ["Himalaya Speman", "Gokshur tab"], "category": "Herbal/Ayurveda", "dosage": "1 tab", "frequency": "BID", "duration": "60 days"},
    {"name": "Confido", "generic": "Polyherbal", "brands": ["Himalaya Confido"], "category": "Herbal/Ayurveda", "dosage": "1 tab", "frequency": "BID", "duration": "90 days", "instructions": "Sexual health support."},
    {"name": "Tentex forte", "generic": "Polyherbal", "brands": ["Himalaya Tentex"], "category": "Herbal/Ayurveda", "dosage": "2 tab", "frequency": "BID", "duration": "30 days"},
    {"name": "Speman forte", "generic": "Polyherbal (fertility)", "brands": ["Himalaya Speman Forte"], "category": "Herbal/Ayurveda", "dosage": "2 tab", "frequency": "BID", "duration": "90 days"},
    {"name": "Punarnava mandur", "generic": "Boerhavia diffusa", "brands": ["Baidyanath Punarnava"], "category": "Herbal/Ayurveda", "dosage": "2 tab", "frequency": "BID", "duration": "30 days"},
    {"name": "Saw Palmetto 320 mg", "generic": "Saw Palmetto", "brands": ["Prostina", "Prostate Care"], "category": "Herbal/Ayurveda", "dosage": "320 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Pygeum 100 mg", "generic": "Pygeum africanum", "brands": ["Prostina-P"], "category": "Herbal/Ayurveda", "dosage": "100 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Cranberry extract 500 mg", "generic": "Cranberry", "brands": ["Uti Clear", "Cranberry Tab"], "category": "Herbal/Ayurveda", "dosage": "500 mg", "frequency": "OD", "duration": "60 days", "instructions": "Recurrent UTI prevention."},
    {"name": "D-Mannose 1 g", "generic": "D-Mannose", "brands": ["D-Mannose powder", "Utiva"], "category": "Herbal/Ayurveda", "dosage": "1 g", "frequency": "BID", "duration": "30 days"},
    {"name": "Probiotic (L. rhamnosus)", "generic": "Lactobacillus", "brands": ["Vizylac", "Darolac"], "category": "Herbal/Ayurveda", "dosage": "1 sachet", "frequency": "OD", "duration": "30 days"},

    # Supplements
    {"name": "L-Arginine 3 g", "generic": "L-Arginine", "brands": ["L-Arg", "Arginine sachet"], "category": "Supplement", "dosage": "3 g", "frequency": "BID", "duration": "90 days", "instructions": "ED adjunct; NO precursor."},
    {"name": "L-Carnitine 500 mg", "generic": "L-Carnitine", "brands": ["Carni-Q", "Carnitor"], "category": "Supplement", "dosage": "500 mg", "frequency": "BID", "duration": "90 days", "instructions": "Male infertility adjunct."},
    {"name": "Coenzyme Q10 100 mg", "generic": "Ubidecarenone", "brands": ["Coq-10", "Cardiq"], "category": "Supplement", "dosage": "100 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Vitamin E 400 IU", "generic": "Tocopherol", "brands": ["Evion-400", "Enat-400"], "category": "Supplement", "dosage": "400 IU", "frequency": "OD", "duration": "30 days"},
    {"name": "Zinc 20 mg", "generic": "Zinc sulphate", "brands": ["Zinconia", "Z&D3"], "category": "Supplement", "dosage": "20 mg", "frequency": "OD", "duration": "60 days"},
    {"name": "Folic acid 5 mg", "generic": "Folate", "brands": ["Folvite", "Folinz"], "category": "Supplement", "dosage": "5 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Vit B12 1500 mcg", "generic": "Methylcobalamin", "brands": ["Nurokind", "Methycobal"], "category": "Supplement", "dosage": "1500 mcg", "frequency": "OD", "duration": "30 days"},
    {"name": "Omega-3 (Fish oil) 1 g", "generic": "Fish oil", "brands": ["Maxepa", "Seven Seas"], "category": "Supplement", "dosage": "1 g", "frequency": "BID", "duration": "90 days"},
    {"name": "Multivitamin + Antioxidant", "generic": "Multivitamin", "brands": ["Revital H", "Becosules"], "category": "Supplement", "dosage": "1 tab/cap", "frequency": "OD", "duration": "30 days"},
    {"name": "Shilajit 500 mg", "generic": "Shilajit", "brands": ["Dabur Shilajit", "Himalaya Shilajit"], "category": "Supplement", "dosage": "500 mg", "frequency": "BID", "duration": "60 days"},
    {"name": "Ashwagandha 300 mg", "generic": "Withania somnifera", "brands": ["Himalaya Ashvagandha", "KSM-66"], "category": "Supplement", "dosage": "300 mg", "frequency": "BID", "duration": "60 days"},
    {"name": "Levocarnitine + Coenzyme Q10 + Arginine", "generic": "Carnitine+CoQ10+Arginine", "brands": ["Addyzoa", "Oligocare", "Fertyl-M"], "category": "Supplement", "dosage": "1 cap", "frequency": "BID", "duration": "90 days", "instructions": "Male infertility combo."},

    # ==================================================================
    # PAEDIATRIC UROLOGY
    # ==================================================================
    {"name": "Syrup Paracetamol 250 mg/5 ml", "generic": "Paracetamol", "brands": ["Crocin Syrup", "Calpol Syrup"], "category": "Paediatric", "dosage": "10-15 mg/kg", "frequency": "Q6H", "duration": "3 days"},
    {"name": "Syrup Ibuprofen 100 mg/5 ml", "generic": "Ibuprofen", "brands": ["Ibugesic", "Brufen Syrup"], "category": "Paediatric", "dosage": "5-10 mg/kg", "frequency": "TID", "duration": "3 days"},
    {"name": "Syrup Cefixime 100 mg/5 ml", "generic": "Cefixime", "brands": ["Taxim-O DT", "Zifi Dry Syrup"], "category": "Paediatric", "dosage": "8 mg/kg/day", "frequency": "BID", "duration": "7 days"},
    {"name": "Syrup Amoxy-Clav 228 mg/5 ml", "generic": "Amoxy-Clav", "brands": ["Augmentin DDS", "Clavam DS"], "category": "Paediatric", "dosage": "25-45 mg/kg/day", "frequency": "BID", "duration": "7 days"},
    {"name": "Imipramine 10 mg (enuresis)", "generic": "Imipramine", "brands": ["Depsol", "Depsonil"], "category": "Paediatric", "dosage": "10 mg", "frequency": "HS", "duration": "90 days", "instructions": "For nocturnal enuresis, 6 yrs+."},
    {"name": "Desmopressin 120 mcg SL (paed)", "generic": "Desmopressin", "brands": ["Minirin Melt 120"], "category": "Paediatric", "dosage": "120 mcg SL", "frequency": "HS", "duration": "30 days"},
    {"name": "Oxybutynin syrup 5 mg/5 ml", "generic": "Oxybutynin", "brands": ["Oxyspas Syrup"], "category": "Paediatric", "dosage": "0.2 mg/kg/dose", "frequency": "TID", "duration": "30 days"},
    {"name": "Trimethoprim suspension (prophy)", "generic": "Trimethoprim", "brands": ["Septran suspension"], "category": "Paediatric", "dosage": "2 mg/kg", "frequency": "HS", "duration": "90 days", "instructions": "VUR UTI prophylaxis."},
    {"name": "Zinc + ORS", "generic": "Zinc + ORS", "brands": ["Zincovit drops", "WHO ORS"], "category": "Paediatric", "dosage": "20 mg Zn + ORS", "frequency": "After each loose stool", "duration": "14 days"},

    # ==================================================================
    # MISC — LOCAL / PRE-OP / POST-OP
    # ==================================================================
    {"name": "Lignocaine 2% Inj", "generic": "Lignocaine", "brands": ["Xylocaine 2%", "Loxicard"], "category": "Local anaesthetic", "dosage": "10-20 ml infiltration", "frequency": "Pre-op", "duration": "PRN"},
    {"name": "Bupivacaine 0.5% Inj", "generic": "Bupivacaine", "brands": ["Sensorcaine", "Bupin"], "category": "Local anaesthetic", "dosage": "10-15 ml", "frequency": "Pre-op", "duration": "PRN"},
    {"name": "Ropivacaine 0.75% Inj", "generic": "Ropivacaine", "brands": ["Naropin", "Ropin"], "category": "Local anaesthetic", "dosage": "15-30 ml", "frequency": "Pre-op", "duration": "PRN"},
    {"name": "EMLA cream (Lidocaine + Prilocaine)", "generic": "Lidocaine+Prilocaine", "brands": ["Emla", "Prilox"], "category": "Local anaesthetic", "dosage": "Apply 1 g", "frequency": "60 min before", "duration": "PRN"},
    {"name": "Atropine 0.6 mg IV", "generic": "Atropine", "brands": ["Atropine Sulphate"], "category": "Pre-op", "dosage": "0.6 mg IV", "frequency": "SOS", "duration": "1 day"},
    {"name": "Midazolam 5 mg IV", "generic": "Midazolam", "brands": ["Dormicum", "Fulsed"], "category": "Pre-op", "dosage": "5 mg IV", "frequency": "Pre-op", "duration": "1 day"},
    {"name": "Propofol 10 mg/ml IV", "generic": "Propofol", "brands": ["Diprivan", "Neorof"], "category": "Pre-op", "dosage": "1-2 mg/kg IV", "frequency": "Induction", "duration": "PRN"},

    # Anti-emetics / anti-vertigo
    {"name": "Prochlorperazine 5 mg", "generic": "Prochlorperazine", "brands": ["Stemetil"], "category": "PPI / GI", "dosage": "5 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Betahistine 16 mg", "generic": "Betahistine", "brands": ["Vertin", "Betavert"], "category": "PPI / GI", "dosage": "16 mg", "frequency": "TID", "duration": "7 days", "instructions": "For post-spinal vertigo."},

    # Anti-HTN commonly on urology Rx
    {"name": "Telmisartan 40 mg", "generic": "Telmisartan", "brands": ["Telma", "Telsartan"], "category": "Anti-HTN", "dosage": "40 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Telmisartan 80 mg", "generic": "Telmisartan", "brands": ["Telma-80"], "category": "Anti-HTN", "dosage": "80 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Amlodipine 5 mg", "generic": "Amlodipine", "brands": ["Amlopres", "Stamlo"], "category": "Anti-HTN", "dosage": "5 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Nifedipine 10 mg", "generic": "Nifedipine", "brands": ["Nicardia", "Depin"], "category": "Anti-HTN", "dosage": "10 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Losartan 50 mg", "generic": "Losartan", "brands": ["Losar", "Covance"], "category": "Anti-HTN", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Ramipril 5 mg", "generic": "Ramipril", "brands": ["Cardace", "Hopace"], "category": "Anti-HTN", "dosage": "5 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Metoprolol 25 mg", "generic": "Metoprolol", "brands": ["Metolar", "Seloken-XL"], "category": "Anti-HTN", "dosage": "25 mg", "frequency": "OD", "duration": "30 days"},

    # Diabetes commonly on Rx
    {"name": "Metformin 500 mg", "generic": "Metformin", "brands": ["Glycomet", "Gluconorm"], "category": "Anti-diabetic", "dosage": "500 mg", "frequency": "BID", "duration": "30 days", "timing": "After food"},
    {"name": "Metformin 1000 mg", "generic": "Metformin", "brands": ["Glycomet-1000"], "category": "Anti-diabetic", "dosage": "1000 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Dapagliflozin 10 mg", "generic": "Dapagliflozin", "brands": ["Forxiga", "Dapamet"], "category": "Anti-diabetic", "dosage": "10 mg", "frequency": "OD", "duration": "30 days", "instructions": "Caution in recurrent UTI."},
    {"name": "Empagliflozin 10 mg", "generic": "Empagliflozin", "brands": ["Jardiance"], "category": "Anti-diabetic", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Glimepiride 1 mg", "generic": "Glimepiride", "brands": ["Amaryl", "Glimy"], "category": "Anti-diabetic", "dosage": "1 mg", "frequency": "OD", "duration": "30 days"},

    # Statins
    {"name": "Atorvastatin 10 mg", "generic": "Atorvastatin", "brands": ["Atorlip-10", "Storvas-10"], "category": "Lipid", "dosage": "10 mg", "frequency": "HS", "duration": "30 days"},
    {"name": "Atorvastatin 20 mg", "generic": "Atorvastatin", "brands": ["Atorlip-20", "Storvas-20"], "category": "Lipid", "dosage": "20 mg", "frequency": "HS", "duration": "30 days"},
    {"name": "Rosuvastatin 10 mg", "generic": "Rosuvastatin", "brands": ["Rosuvas", "Rozavel"], "category": "Lipid", "dosage": "10 mg", "frequency": "HS", "duration": "30 days"},

    # Hormones (thyroid)
    {"name": "Levothyroxine 50 mcg", "generic": "Levothyroxine", "brands": ["Eltroxin", "Thyronorm"], "category": "Hormone", "dosage": "50 mcg", "frequency": "OD", "duration": "30 days", "timing": "Empty stomach"},
    {"name": "Levothyroxine 100 mcg", "generic": "Levothyroxine", "brands": ["Eltroxin-100", "Thyronorm-100"], "category": "Hormone", "dosage": "100 mcg", "frequency": "OD", "duration": "30 days"},

    # BP / Nitrate (CAUTION in ED)
    {"name": "GTN 0.5 mg sublingual", "generic": "Nitroglycerin", "brands": ["Angised", "Nitrocontin"], "category": "Anti-HTN", "dosage": "0.5 mg SL", "frequency": "SOS", "duration": "PRN", "instructions": "DO NOT co-prescribe with PDE5 inhibitors."},
    {"name": "Isosorbide dinitrate 10 mg", "generic": "Isosorbide dinitrate", "brands": ["Isordil", "Sorbitrate"], "category": "Anti-HTN", "dosage": "10 mg", "frequency": "TID", "duration": "30 days"},

    # Corticosteroids (non-transplant)
    {"name": "Dexamethasone 4 mg IV", "generic": "Dexamethasone", "brands": ["Decadron", "Dexona"], "category": "Corticosteroid", "dosage": "4 mg IV", "frequency": "SOS", "duration": "PRN"},
    {"name": "Hydrocortisone 100 mg IV", "generic": "Hydrocortisone", "brands": ["Efcorlin", "Lyophilised HC"], "category": "Corticosteroid", "dosage": "100 mg IV", "frequency": "Q6H", "duration": "3 days"},
    {"name": "Betamethasone cream", "generic": "Betamethasone", "brands": ["Betnovate", "Betnesol"], "category": "Corticosteroid", "dosage": "Apply locally", "frequency": "BID", "duration": "14 days"},

    # Antiretroviral (for HIV+ urology patients)
    {"name": "Tenofovir + Lamivudine + Efavirenz", "generic": "TLE", "brands": ["Viraday", "Trioday"], "category": "ART", "dosage": "1 tab FDC", "frequency": "HS", "duration": "30 days"},
    {"name": "Dolutegravir + Lamivudine + TDF", "generic": "DTG+3TC+TDF", "brands": ["Acriptega", "TLD"], "category": "ART", "dosage": "1 tab FDC", "frequency": "OD", "duration": "30 days"},

    # ==================================================================
    # SUPPLEMENTARY — Major Indian pharma brand coverage (Apr 2026)
    # Ipca · Cipla · Sun Pharma · Intas · Lupin · Dr Reddy's · Mankind ·
    # Overseas · Ignyx · Corona Remedies · Abbott · Zydus · Torrent ·
    # Glenmark · Alkem · Micro Labs
    # ==================================================================

    # --- BPH · Alpha-blockers (extended brands) ---
    {"name": "Tamsulosin 0.4 mg (extended brands)", "generic": "Tamsulosin", "brands": ["Urotone", "Flomax", "Tams", "Tamlet", "Tamdura", "Tamsol", "Prostamax"], "category": "Alpha-blocker", "dosage": "0.4 mg", "frequency": "HS", "duration": "30 days"},
    {"name": "Silodosin 8 mg (extended brands)", "generic": "Silodosin", "brands": ["Silotrip", "Silodal", "Silopro", "Silogen", "Silovas", "Sildoflo", "Prosil"], "category": "Alpha-blocker", "dosage": "8 mg", "frequency": "OD", "duration": "30 days", "timing": "With dinner"},
    {"name": "Alfuzosin SR 10 mg (extended brands)", "generic": "Alfuzosin", "brands": ["Alfusin-D", "Alfuzo", "Alphapress", "Alfoo", "Alface"], "category": "Alpha-blocker", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},

    # --- BPH · Combos (extended brands) ---
    {"name": "Tamsulosin + Dutasteride (0.4/0.5 mg)", "generic": "Tamsulosin+Dutasteride", "brands": ["Urimax-D", "Duodart", "Veltam-Plus", "Dynapres-T", "Dutalfa", "Dutaprost", "Urogenix-D", "Silopro-D"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},
    {"name": "Silodosin + Dutasteride (8/0.5 mg) (extended)", "generic": "Silodosin+Dutasteride", "brands": ["Silofast-D", "Silotrip-D", "Silodal-D", "Silopro-D"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},
    {"name": "Tamsulosin + Finasteride (0.4/5 mg)", "generic": "Tamsulosin+Finasteride", "brands": ["Urimax-F", "Finast-T", "Finox-T", "Fincar-T"], "category": "BPH combo", "dosage": "1 cap", "frequency": "HS", "duration": "90 days"},

    # --- OAB · Antimuscarinics + β3 (extended brands) ---
    {"name": "Solifenacin 5 mg (extended brands)", "generic": "Solifenacin", "brands": ["Vesicare", "Soligen", "Solitrol", "Prosoli", "Solitam", "Solidin", "Pro-Ves", "Solibid"], "category": "OAB", "dosage": "5 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Solifenacin 10 mg (extended)", "generic": "Solifenacin", "brands": ["Vesicare-10", "Soligen-10", "Solidin-10", "Solitam-10"], "category": "OAB", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Mirabegron 25 mg (extended brands)", "generic": "Mirabegron", "brands": ["Mirabeg", "Betmiga-25", "Miragen", "Mirasure", "Beta-Ig-25", "Mirado", "Mybetriq-25"], "category": "OAB", "dosage": "25 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Mirabegron 50 mg (extended brands)", "generic": "Mirabegron", "brands": ["Mirabeg-50", "Betmiga", "Miragen-50", "Beta-Ig", "Mybetriq"], "category": "OAB", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Solifenacin + Mirabegron (5/50 mg)", "generic": "Solifenacin+Mirabegron", "brands": ["Vesomni-M", "Betmiga-S"], "category": "OAB", "dosage": "1 tab", "frequency": "OD", "duration": "30 days", "instructions": "Combination for refractory OAB."},
    {"name": "Imidafenacin 0.1 mg", "generic": "Imidafenacin", "brands": ["Staybla", "Uritos"], "category": "OAB", "dosage": "0.1 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "Vibegron 75 mg", "generic": "Vibegron", "brands": ["Gemtesa"], "category": "OAB", "dosage": "75 mg", "frequency": "OD", "duration": "30 days", "instructions": "β3-agonist; minimal anticholinergic burden."},

    # --- ED / PDE5 (extended brands) ---
    {"name": "Sildenafil 25 mg", "generic": "Sildenafil", "brands": ["Penegra-25", "Caverta-25", "Silagra-25", "Manforce-25", "Suhagra-25", "Edegra-25"], "category": "ED", "dosage": "25 mg", "frequency": "SOS", "duration": "PRN", "timing": "30-60 min before intercourse"},
    {"name": "Sildenafil 50 mg (extended brands)", "generic": "Sildenafil", "brands": ["Penegra", "Caverta", "Silagra", "Manforce", "Suhagra", "Edegra", "Viagra"], "category": "ED", "dosage": "50 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Sildenafil 100 mg (extended brands)", "generic": "Sildenafil", "brands": ["Penegra-100", "Caverta-100", "Silagra-100", "Manforce-100", "Suhagra-100", "Viagra-100"], "category": "ED", "dosage": "100 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Tadalafil 10 mg (extended brands)", "generic": "Tadalafil", "brands": ["Tadacip-10", "Megalis-10", "Forzest-10", "Tazzle-10", "Sunfil-10", "Tadaflo-10"], "category": "ED", "dosage": "10 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Tadalafil 20 mg (extended brands)", "generic": "Tadalafil", "brands": ["Tadacip", "Megalis-20", "Forzest-20", "Tazzle-20", "Tadaflo", "Vidalista"], "category": "ED", "dosage": "20 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Vardenafil 10 mg", "generic": "Vardenafil", "brands": ["Vivanza-10", "Valif-10", "Zhewitra-10"], "category": "ED", "dosage": "10 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Vardenafil 20 mg (extended)", "generic": "Vardenafil", "brands": ["Vivanza", "Levitra", "Valif", "Zhewitra"], "category": "ED", "dosage": "20 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Avanafil 100 mg", "generic": "Avanafil", "brands": ["Stendra", "Avaforce-100"], "category": "ED", "dosage": "100 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Avanafil 200 mg", "generic": "Avanafil", "brands": ["Stendra-200", "Avaforce"], "category": "ED", "dosage": "200 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Udenafil 100 mg", "generic": "Udenafil", "brands": ["Zydena"], "category": "ED", "dosage": "100 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Sildenafil + Dapoxetine (50/30 mg)", "generic": "Sildenafil+Dapoxetine", "brands": ["Duratia-S", "Super P-Force", "Manforce-Staylong"], "category": "ED / PE", "dosage": "1 tab", "frequency": "SOS", "duration": "PRN", "instructions": "For ED with premature ejaculation."},
    {"name": "Tadalafil + Dapoxetine (20/60 mg)", "generic": "Tadalafil+Dapoxetine", "brands": ["Super Vidalista", "Tadapox"], "category": "ED / PE", "dosage": "1 tab", "frequency": "SOS", "duration": "PRN"},

    # --- Premature ejaculation ---
    {"name": "Dapoxetine 30 mg", "generic": "Dapoxetine", "brands": ["Duratia-30", "Poxet-30", "Westoxetin-30", "Sustinex-30"], "category": "PE", "dosage": "30 mg", "frequency": "SOS", "duration": "PRN", "instructions": "1-3 h before sex; do not exceed once/24 h."},
    {"name": "Dapoxetine 60 mg", "generic": "Dapoxetine", "brands": ["Duratia-60", "Poxet-60", "Sustinex-60"], "category": "PE", "dosage": "60 mg", "frequency": "SOS", "duration": "PRN"},
    {"name": "Lidocaine-Prilocaine cream", "generic": "Lidocaine+Prilocaine", "brands": ["Prilox", "Numit", "EMLA", "Pricaine"], "category": "PE", "dosage": "Apply locally", "frequency": "SOS", "duration": "PRN", "instructions": "Apply 20 min before intercourse; wipe before sex."},

    # --- Prostate cancer · Hormonal ---
    {"name": "Bicalutamide 50 mg (extended)", "generic": "Bicalutamide", "brands": ["Calutide", "Bicalox", "Bicatero", "Bicalutide", "Casodex"], "category": "Oncology", "dosage": "50 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Bicalutamide 150 mg", "generic": "Bicalutamide", "brands": ["Calutide-150", "Bicalox-150"], "category": "Oncology", "dosage": "150 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Flutamide 250 mg", "generic": "Flutamide", "brands": ["Flutamid", "Drogenil"], "category": "Oncology", "dosage": "250 mg", "frequency": "TID", "duration": "30 days"},
    {"name": "Nilutamide 150 mg", "generic": "Nilutamide", "brands": ["Nilandron"], "category": "Oncology", "dosage": "150 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Enzalutamide 40 mg", "generic": "Enzalutamide", "brands": ["Xtandi", "Bdenza"], "category": "Oncology", "dosage": "160 mg (4 caps)", "frequency": "OD", "duration": "30 days", "instructions": "For CRPC; monitor seizures."},
    {"name": "Apalutamide 60 mg", "generic": "Apalutamide", "brands": ["Erleada"], "category": "Oncology", "dosage": "240 mg (4 tabs)", "frequency": "OD", "duration": "30 days"},
    {"name": "Abiraterone 250 mg", "generic": "Abiraterone", "brands": ["Zytiga", "Abirapro", "Zybira", "Abirater"], "category": "Oncology", "dosage": "1000 mg (4 tabs)", "frequency": "OD", "duration": "30 days", "timing": "Empty stomach", "instructions": "Co-prescribe Prednisolone 5 mg BID."},
    {"name": "Abiraterone 500 mg", "generic": "Abiraterone", "brands": ["Zytiga-500", "Abirapro-500"], "category": "Oncology", "dosage": "1000 mg (2 tabs)", "frequency": "OD", "duration": "30 days"},
    {"name": "Darolutamide 300 mg", "generic": "Darolutamide", "brands": ["Nubeqa"], "category": "Oncology", "dosage": "600 mg (2 tabs)", "frequency": "BID", "duration": "30 days"},
    {"name": "Leuprolide 3.75 mg Depot", "generic": "Leuprolide", "brands": ["Lupride", "Lupron Depot", "Lucrin Depot"], "category": "GnRH agonist", "dosage": "3.75 mg IM", "frequency": "Monthly", "duration": "3 months"},
    {"name": "Leuprolide 11.25 mg Depot (3-mth)", "generic": "Leuprolide", "brands": ["Lupride-3M", "Lucrin 3-Month"], "category": "GnRH agonist", "dosage": "11.25 mg IM", "frequency": "Every 12 wk", "duration": "6 months"},
    {"name": "Goserelin 3.6 mg (1-mth)", "generic": "Goserelin", "brands": ["Zoladex", "Goserin"], "category": "GnRH agonist", "dosage": "3.6 mg SC", "frequency": "Monthly", "duration": "3 months"},
    {"name": "Goserelin 10.8 mg (3-mth)", "generic": "Goserelin", "brands": ["Zoladex LA", "Goserin-3M"], "category": "GnRH agonist", "dosage": "10.8 mg SC", "frequency": "Every 12 wk", "duration": "6 months"},
    {"name": "Degarelix 80 mg", "generic": "Degarelix", "brands": ["Firmagon"], "category": "GnRH antagonist", "dosage": "80 mg SC", "frequency": "Monthly", "duration": "3 months", "instructions": "Loading 240 mg on day 0."},
    {"name": "Triptorelin 3.75 mg", "generic": "Triptorelin", "brands": ["Decapeptyl", "Trip-M"], "category": "GnRH agonist", "dosage": "3.75 mg IM", "frequency": "Monthly", "duration": "3 months"},
    {"name": "Relugolix 120 mg", "generic": "Relugolix", "brands": ["Orgovyx"], "category": "GnRH antagonist oral", "dosage": "120 mg (loading 360)", "frequency": "OD", "duration": "30 days"},

    # --- Chemotherapy (urothelial / RCC / testicular) ---
    {"name": "Gemcitabine 1 g IV", "generic": "Gemcitabine", "brands": ["Gemcite", "Gemita", "Gemtaz"], "category": "Chemo", "dosage": "1000 mg/m²", "frequency": "Weekly", "duration": "Cycle-based", "instructions": "Oncology protocol; part of GC for urothelial."},
    {"name": "Cisplatin 50 mg IV", "generic": "Cisplatin", "brands": ["Cisplat", "Cytoplat"], "category": "Chemo", "dosage": "70 mg/m²", "frequency": "Cycle", "duration": "Cycle-based"},
    {"name": "Pembrolizumab 100 mg IV", "generic": "Pembrolizumab", "brands": ["Keytruda"], "category": "Immunotherapy", "dosage": "200 mg IV", "frequency": "Every 3 wk", "duration": "Cycle-based"},
    {"name": "Nivolumab 100 mg IV", "generic": "Nivolumab", "brands": ["Opdivo"], "category": "Immunotherapy", "dosage": "240 mg IV", "frequency": "Every 2 wk", "duration": "Cycle-based"},
    {"name": "Sunitinib 50 mg", "generic": "Sunitinib", "brands": ["Sutent", "Sunib"], "category": "TKI", "dosage": "50 mg", "frequency": "OD", "duration": "4 wk on / 2 wk off", "instructions": "For advanced RCC."},
    {"name": "Pazopanib 400 mg", "generic": "Pazopanib", "brands": ["Votrient", "Pazonib"], "category": "TKI", "dosage": "800 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Cabozantinib 40 mg", "generic": "Cabozantinib", "brands": ["Cabometyx"], "category": "TKI", "dosage": "40 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Axitinib 5 mg", "generic": "Axitinib", "brands": ["Inlyta"], "category": "TKI", "dosage": "5 mg", "frequency": "BID", "duration": "30 days"},
    {"name": "BCG Intravesical 80 mg", "generic": "BCG", "brands": ["OncoTICE", "BCG-Vac", "ImmuCyst"], "category": "Intravesical", "dosage": "80 mg intravesical", "frequency": "Weekly", "duration": "6 wk induction + maintenance"},
    {"name": "Mitomycin-C 40 mg", "generic": "Mitomycin", "brands": ["Mitozytrex", "Mitonco"], "category": "Intravesical", "dosage": "40 mg intravesical", "frequency": "Weekly", "duration": "6 wk"},

    # --- Urinary tract antibiotics (expanded brand coverage) ---
    {"name": "Nitrofurantoin 100 mg (extended brands)", "generic": "Nitrofurantoin", "brands": ["Martifur", "Niftas", "Nitrofur", "Uvamin", "Macrobid", "Nitrocap"], "category": "Antibiotic", "dosage": "100 mg", "frequency": "BID", "duration": "7 days", "timing": "With food"},
    {"name": "Fosfomycin Trometamol 3 g sachet", "generic": "Fosfomycin", "brands": ["Urimax-F Sachet", "Fosfotrust", "Fosfocin", "Monurol"], "category": "Antibiotic", "dosage": "3 g sachet", "frequency": "Single dose", "duration": "1 day", "timing": "Empty stomach at bedtime", "instructions": "Dissolve in half glass water."},
    {"name": "Pivmecillinam 200 mg", "generic": "Pivmecillinam", "brands": ["Penomax"], "category": "Antibiotic", "dosage": "200 mg", "frequency": "TID", "duration": "5 days"},
    {"name": "Trimethoprim-Sulfamethoxazole DS", "generic": "Co-trimoxazole", "brands": ["Bactrim DS", "Septran DS", "Ciplin DS"], "category": "Antibiotic", "dosage": "160/800 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ciprofloxacin 500 mg (extended)", "generic": "Ciprofloxacin", "brands": ["Cifran", "Ciplox", "Cipro", "Ciprobid", "Quintor"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ciprofloxacin 1 g OD", "generic": "Ciprofloxacin", "brands": ["Cifran OD", "Ciprobid OD"], "category": "Antibiotic", "dosage": "1000 mg ER", "frequency": "OD", "duration": "7 days"},
    {"name": "Levofloxacin 500 mg (extended)", "generic": "Levofloxacin", "brands": ["Levoflox", "Levoday", "Levodac", "Tavanic", "Glevo"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "OD", "duration": "7 days"},
    {"name": "Levofloxacin 750 mg", "generic": "Levofloxacin", "brands": ["Levoflox-750", "Glevo-750", "Levoday-750"], "category": "Antibiotic", "dosage": "750 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Ofloxacin 200 mg", "generic": "Ofloxacin", "brands": ["Oflox", "Zanocin", "Zenflox"], "category": "Antibiotic", "dosage": "200 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Moxifloxacin 400 mg", "generic": "Moxifloxacin", "brands": ["Moxif", "Avelox", "Mahaflox"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "OD", "duration": "7 days"},
    {"name": "Amoxicillin-Clavulanate 625 mg", "generic": "Amoxicillin+Clav", "brands": ["Augmentin", "Clavam", "Moxikind-CV", "Mega-CV", "Amoxyclav"], "category": "Antibiotic", "dosage": "625 mg", "frequency": "TID", "duration": "7 days"},
    {"name": "Amoxicillin-Clavulanate 1 g", "generic": "Amoxicillin+Clav", "brands": ["Augmentin 1g", "Clavam 1g", "Moxikind-CV 1g"], "category": "Antibiotic", "dosage": "1 g", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefixime 200 mg", "generic": "Cefixime", "brands": ["Taxim-O", "Cefix", "Zifi", "Mahacef", "Ceftas"], "category": "Antibiotic", "dosage": "200 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefixime-Ofloxacin", "generic": "Cefixime+Ofloxacin", "brands": ["Taxim-O Forte", "Zifi-OF", "Mahacef-OF"], "category": "Antibiotic", "dosage": "1 tab", "frequency": "BID", "duration": "5 days"},
    {"name": "Cefuroxime 500 mg", "generic": "Cefuroxime", "brands": ["Ceftum", "Supacef", "Cefakind"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Cefadroxil 500 mg", "generic": "Cefadroxil", "brands": ["Odoxil", "Cedrox", "Droxyl"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Ceftriaxone 1 g IV/IM", "generic": "Ceftriaxone", "brands": ["Monocef", "Oframax", "Cefaxone", "Roxim", "Intacef"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "OD", "duration": "5 days"},
    {"name": "Ceftriaxone-Sulbactam 1.5 g", "generic": "Ceftriaxone+Sulbactam", "brands": ["Monocef-SB", "Supacef-SB", "Xone-SB"], "category": "Antibiotic", "dosage": "1.5 g IV", "frequency": "BD", "duration": "5 days"},
    {"name": "Cefoperazone-Sulbactam 1.5 g", "generic": "Cefoperazone+Sulbactam", "brands": ["Magnex", "Sulbacef", "Cefactam"], "category": "Antibiotic", "dosage": "1.5 g IV", "frequency": "BID", "duration": "5 days"},
    {"name": "Piperacillin-Tazobactam 4.5 g", "generic": "Piperacillin+Tazobactam", "brands": ["Zosyn", "Pipzo", "Tazact", "Pipracil-TZ"], "category": "Antibiotic", "dosage": "4.5 g IV", "frequency": "Q8H", "duration": "7 days"},
    {"name": "Meropenem 1 g IV", "generic": "Meropenem", "brands": ["Meronem", "Mecitem", "Meropen", "Merotrol"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "Q8H", "duration": "7 days"},
    {"name": "Imipenem-Cilastatin 500 mg", "generic": "Imipenem+Cilastatin", "brands": ["Cilanem", "Primaxin", "Imecil"], "category": "Antibiotic", "dosage": "500 mg IV", "frequency": "Q6H", "duration": "7 days"},
    {"name": "Ertapenem 1 g IV", "generic": "Ertapenem", "brands": ["Invanz"], "category": "Antibiotic", "dosage": "1 g IV", "frequency": "OD", "duration": "7 days"},
    {"name": "Amikacin 500 mg IV", "generic": "Amikacin", "brands": ["Mikacin", "Amikin", "Amistar"], "category": "Antibiotic", "dosage": "500 mg IV", "frequency": "BID", "duration": "7 days", "instructions": "Monitor renal function."},
    {"name": "Gentamicin 80 mg IV", "generic": "Gentamicin", "brands": ["Garamycin", "Genticyn"], "category": "Antibiotic", "dosage": "80 mg IV", "frequency": "TID", "duration": "5 days"},
    {"name": "Doxycycline 100 mg", "generic": "Doxycycline", "brands": ["Doxy-1", "Doxt", "Minicycline"], "category": "Antibiotic", "dosage": "100 mg", "frequency": "BID", "duration": "7 days"},
    {"name": "Azithromycin 500 mg", "generic": "Azithromycin", "brands": ["Azithral", "Azee", "Zithromax", "Zadro"], "category": "Antibiotic", "dosage": "500 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Metronidazole 400 mg", "generic": "Metronidazole", "brands": ["Flagyl", "Metrogyl", "Aristogyl"], "category": "Antibiotic", "dosage": "400 mg", "frequency": "TID", "duration": "7 days"},

    # --- Urinary analgesic / antispasmodic (extended) ---
    {"name": "Phenazopyridine 100 mg", "generic": "Phenazopyridine", "brands": ["Pyridium", "Urispas-P", "AZO"], "category": "Urinary analgesic", "dosage": "100 mg", "frequency": "TID", "duration": "2 days", "instructions": "Orange-red urine expected; short-term only."},
    {"name": "Hyoscine butylbromide 10 mg", "generic": "Hyoscine", "brands": ["Buscogast", "Buscopan", "Hyosine"], "category": "Antispasmodic", "dosage": "10 mg", "frequency": "TID", "duration": "5 days"},
    {"name": "Drotaverine 80 mg", "generic": "Drotaverine", "brands": ["Drotin", "Drotagyl", "Deflazina"], "category": "Antispasmodic", "dosage": "80 mg", "frequency": "TID", "duration": "5 days"},
    {"name": "Drotaverine + Mefenamic 80/250 mg", "generic": "Drotaverine+Mefenamic", "brands": ["Drotin-M", "Meftal-Spas"], "category": "Antispasmodic", "dosage": "1 tab", "frequency": "TID", "duration": "3 days", "instructions": "For renal colic adjunct."},
    {"name": "Dicyclomine 10 mg", "generic": "Dicyclomine", "brands": ["Cyclopam", "Colimex", "Dicytel"], "category": "Antispasmodic", "dosage": "10 mg", "frequency": "TID", "duration": "3 days"},

    # --- Pain / NSAIDs / Paracetamol (common in urology) ---
    {"name": "Paracetamol 650 mg", "generic": "Paracetamol", "brands": ["Dolo-650", "Calpol-650", "Crocin Advance", "PCM-650", "Pacimol-650"], "category": "Analgesic", "dosage": "650 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Aceclofenac 100 mg", "generic": "Aceclofenac", "brands": ["Zerodol", "Hifenac", "Aceclo"], "category": "Analgesic", "dosage": "100 mg", "frequency": "BID", "duration": "5 days", "timing": "After food"},
    {"name": "Aceclofenac + Paracetamol", "generic": "Aceclofenac+PCM", "brands": ["Zerodol-P", "Hifenac-P", "Aceclo-Plus"], "category": "Analgesic", "dosage": "1 tab", "frequency": "BID", "duration": "5 days"},
    {"name": "Diclofenac 50 mg", "generic": "Diclofenac", "brands": ["Voveran", "Reactine", "Dicloran"], "category": "Analgesic", "dosage": "50 mg", "frequency": "TID", "duration": "5 days"},
    {"name": "Diclofenac SR 100 mg", "generic": "Diclofenac", "brands": ["Voveran-SR", "Dicloran-SR"], "category": "Analgesic", "dosage": "100 mg", "frequency": "BID", "duration": "5 days"},
    {"name": "Ibuprofen 400 mg", "generic": "Ibuprofen", "brands": ["Brufen", "Combiflam (with PCM)", "Ibugesic"], "category": "Analgesic", "dosage": "400 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Ketorolac 10 mg", "generic": "Ketorolac", "brands": ["Ketorol", "Ketanov", "Zorfen"], "category": "Analgesic", "dosage": "10 mg", "frequency": "QID", "duration": "5 days"},
    {"name": "Ketorolac 30 mg IV/IM", "generic": "Ketorolac", "brands": ["Ketorol IV", "Ketanov"], "category": "Analgesic", "dosage": "30 mg IV/IM", "frequency": "Q6H", "duration": "2 days"},
    {"name": "Etoricoxib 60 mg", "generic": "Etoricoxib", "brands": ["Etody", "Etoshine", "Nucoxia"], "category": "Analgesic", "dosage": "60 mg", "frequency": "OD", "duration": "5 days"},
    {"name": "Etoricoxib 120 mg", "generic": "Etoricoxib", "brands": ["Etody-120", "Etoshine-120", "Nucoxia-120"], "category": "Analgesic", "dosage": "120 mg", "frequency": "OD", "duration": "3 days"},
    {"name": "Tramadol 50 mg", "generic": "Tramadol", "brands": ["Ultracet", "Tramazac", "Contramal"], "category": "Analgesic", "dosage": "50 mg", "frequency": "Q6H", "duration": "3 days"},
    {"name": "Tramadol + Paracetamol", "generic": "Tramadol+PCM", "brands": ["Ultracet", "Tramacad-P", "Acuvin"], "category": "Analgesic", "dosage": "1 tab", "frequency": "Q6H", "duration": "3 days"},
    {"name": "Buprenorphine 0.2 mg SL", "generic": "Buprenorphine", "brands": ["Tidigesic", "Norspan"], "category": "Opioid", "dosage": "0.2 mg SL", "frequency": "Q8H", "duration": "PRN"},

    # --- Hematuria / bleeding ---
    {"name": "Tranexamic acid 500 mg (extended)", "generic": "Tranexamic acid", "brands": ["Pause", "Trapic", "Transamin", "Hemstop-500", "Clottix"], "category": "Hemostatic", "dosage": "500 mg", "frequency": "TID", "duration": "5 days"},
    {"name": "Tranexamic acid 1 g", "generic": "Tranexamic acid", "brands": ["Pause-1000", "Trapic-MF", "Clottix-1G"], "category": "Hemostatic", "dosage": "1 g", "frequency": "TID", "duration": "3 days"},
    {"name": "Tranexamic + Mefenamic", "generic": "Tranexamic+Mefenamic", "brands": ["Trapic-MF", "Pause-MF"], "category": "Hemostatic", "dosage": "1 tab", "frequency": "TID", "duration": "3 days"},
    {"name": "Ethamsylate 500 mg", "generic": "Ethamsylate", "brands": ["Revici", "Styptocid", "K-Stat"], "category": "Hemostatic", "dosage": "500 mg", "frequency": "TID", "duration": "5 days"},

    # --- Stone prevention / metabolic (extended) ---
    {"name": "Potassium citrate SR 1080 mg", "generic": "Potassium citrate", "brands": ["Urikind-K10", "Alkasol", "Potrate-SR"], "category": "Stones", "dosage": "10 mEq", "frequency": "BID", "duration": "90 days"},
    {"name": "Magnesium citrate + B6", "generic": "Mg-citrate+B6", "brands": ["Magocit", "Urocit-B6"], "category": "Stones", "dosage": "1 tab", "frequency": "OD", "duration": "30 days"},
    {"name": "Thiopronin 100 mg (cystine)", "generic": "Thiopronin", "brands": ["Thiola"], "category": "Stones", "dosage": "100 mg", "frequency": "TID", "duration": "90 days", "instructions": "For cystinuria."},
    {"name": "Captopril 25 mg (cystine)", "generic": "Captopril", "brands": ["Capoten", "Aceten"], "category": "Stones", "dosage": "25 mg", "frequency": "TID", "duration": "90 days"},
    {"name": "Febuxostat 40 mg", "generic": "Febuxostat", "brands": ["Zurig", "Febuxa", "Febutaz"], "category": "Stones", "dosage": "40 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Febuxostat 80 mg", "generic": "Febuxostat", "brands": ["Zurig-80", "Febuxa-80", "Febutaz-80"], "category": "Stones", "dosage": "80 mg", "frequency": "OD", "duration": "90 days"},

    # --- Testosterone / andrology ---
    {"name": "Testosterone undecanoate 1 g IM (Nebido)", "generic": "Testosterone", "brands": ["Nebido", "Testoviron"], "category": "Testosterone", "dosage": "1 g IM", "frequency": "Every 10-14 wk", "duration": "Long-term", "instructions": "Hypogonadism therapy; monitor PSA + Hb."},
    {"name": "Testosterone enanthate 250 mg IM", "generic": "Testosterone", "brands": ["Testoviron Depot", "Cernos Depot"], "category": "Testosterone", "dosage": "250 mg IM", "frequency": "Every 2-3 wk", "duration": "Long-term"},
    {"name": "Testosterone gel 1%", "generic": "Testosterone", "brands": ["Testogel", "Androgel", "Cernos Gel"], "category": "Testosterone", "dosage": "5 g (50 mg)", "frequency": "OD topical", "duration": "30 days"},
    {"name": "Clomiphene citrate 25 mg", "generic": "Clomiphene", "brands": ["Clom", "Fertomid-25", "Ovofar-25"], "category": "Andrology", "dosage": "25 mg", "frequency": "OD", "duration": "90 days", "instructions": "Off-label for hypogonadism preserving fertility."},
    {"name": "Tamoxifen 10 mg (gynecomastia)", "generic": "Tamoxifen", "brands": ["Nolvadex-10", "Tamodex-10"], "category": "Andrology", "dosage": "10 mg", "frequency": "OD", "duration": "60 days"},
    {"name": "Anastrozole 1 mg", "generic": "Anastrozole", "brands": ["Arimidex", "Anazole"], "category": "Andrology", "dosage": "1 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "hCG 5000 IU IM", "generic": "hCG", "brands": ["Pregnyl", "HUCOG", "Corion"], "category": "Andrology", "dosage": "5000 IU IM", "frequency": "Every 3-5 days", "duration": "3 months"},

    # --- Fertility (male) ---
    {"name": "L-Carnitine + Acetyl-L-Carnitine + CoQ10", "generic": "Carnitine+ALC+CoQ10", "brands": ["Addyzoa", "Fertyl", "Aminoleban-H", "Spermotrend"], "category": "Male fertility", "dosage": "1 cap", "frequency": "BID", "duration": "90 days", "instructions": "Sperm-quality supplement; 3 months to re-assess."},
    {"name": "Coenzyme Q10 200 mg", "generic": "Coenzyme Q10", "brands": ["CoQ-200", "Cogilife"], "category": "Male fertility", "dosage": "200 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "Lycopene + Multivitamin", "generic": "Lycopene+Multi", "brands": ["Lycostar", "Carotene-E", "Supradyn"], "category": "Male fertility", "dosage": "1 tab", "frequency": "OD", "duration": "90 days"},
    {"name": "Zinc 50 mg + Folate", "generic": "Zinc+Folate", "brands": ["Zincovit", "Folzin"], "category": "Supplement", "dosage": "1 tab", "frequency": "OD", "duration": "90 days"},

    # --- Nutraceuticals (common patient add-ons) ---
    {"name": "Saw Palmetto 160 mg", "generic": "Saw palmetto", "brands": ["Prostate-Care", "Prostalin", "Prosta-Q"], "category": "BPH supplement", "dosage": "160 mg", "frequency": "BID", "duration": "90 days", "instructions": "Adjunct; evidence modest."},
    {"name": "Cranberry 500 mg", "generic": "Cranberry", "brands": ["Cystoberry", "UritaPro", "Uri-care"], "category": "UTI prophylaxis", "dosage": "500 mg", "frequency": "OD", "duration": "90 days"},
    {"name": "D-Mannose 2 g", "generic": "D-Mannose", "brands": ["UrtiAvoid", "CystexPlus", "Uridose"], "category": "UTI prophylaxis", "dosage": "2 g", "frequency": "OD", "duration": "90 days"},
    {"name": "Cystone tablets (Himalaya)", "generic": "Herbal-litholytic", "brands": ["Cystone", "Calcury", "K-Stone"], "category": "Stones supplement", "dosage": "2 tabs", "frequency": "BID", "duration": "90 days"},
    {"name": "Neeri syrup", "generic": "Herbal", "brands": ["Neeri (Aimil)", "Neeri-KFT"], "category": "Stones supplement", "dosage": "10 ml", "frequency": "BID", "duration": "30 days"},

    # --- Sodium / alkalinizers (contrast induced prevention / metabolic) ---
    {"name": "Sodium bicarbonate 500 mg", "generic": "Sodium bicarbonate", "brands": ["Sodamint", "Bical", "NaHCO3"], "category": "Alkalinizer", "dosage": "500 mg", "frequency": "TID", "duration": "14 days"},
    {"name": "Disodium hydrogen citrate syrup", "generic": "Na-citrate", "brands": ["Cital", "Alkaurim"], "category": "Alkalinizer", "dosage": "10 ml", "frequency": "TID", "duration": "14 days", "timing": "After meals"},

    # --- Renal / ESRD adjuncts ---
    {"name": "Sevelamer 800 mg", "generic": "Sevelamer", "brands": ["Renvela", "Selam", "Sevmax"], "category": "Phosphate binder", "dosage": "800 mg", "frequency": "TID", "duration": "30 days"},
    {"name": "Cinacalcet 30 mg", "generic": "Cinacalcet", "brands": ["Sensipar", "Cinacal"], "category": "Secondary HPT", "dosage": "30 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Calcitriol 0.25 mcg", "generic": "Calcitriol", "brands": ["Rocaltrol", "Calcirol D3"], "category": "Vit-D analogue", "dosage": "0.25 mcg", "frequency": "OD", "duration": "30 days"},
    {"name": "Iron sucrose 100 mg IV", "generic": "Iron sucrose", "brands": ["Orofer-S", "Venofer"], "category": "Iron", "dosage": "100 mg IV", "frequency": "Weekly", "duration": "3 doses"},
    {"name": "Erythropoietin 4000 IU", "generic": "EPO", "brands": ["Eprex", "Ceriton", "Epofit"], "category": "ESA", "dosage": "4000 IU SC", "frequency": "Thrice weekly", "duration": "30 days"},

    # --- Anticoagulation (peri-op / transplant) ---
    {"name": "Enoxaparin 40 mg SC", "generic": "Enoxaparin", "brands": ["Clexane", "Lomoh", "Lupenox"], "category": "Anticoagulant", "dosage": "40 mg SC", "frequency": "OD", "duration": "7 days"},
    {"name": "Rivaroxaban 10 mg", "generic": "Rivaroxaban", "brands": ["Xarelto", "Ribarix", "Rivasure"], "category": "Anticoagulant", "dosage": "10 mg", "frequency": "OD", "duration": "30 days"},
    {"name": "Apixaban 5 mg", "generic": "Apixaban", "brands": ["Eliquis", "Apixafort", "Apixaban"], "category": "Anticoagulant", "dosage": "5 mg", "frequency": "BID", "duration": "30 days"},

    # --- Immunosuppressants (renal transplant) ---
    {"name": "Tacrolimus 0.5 mg", "generic": "Tacrolimus", "brands": ["Pangraf", "Tacroma", "Prograf"], "category": "Transplant immunosuppressant", "dosage": "0.5 mg", "frequency": "BID", "duration": "Long-term", "instructions": "Monitor trough levels."},
    {"name": "Tacrolimus 1 mg", "generic": "Tacrolimus", "brands": ["Pangraf-1", "Tacroma-1", "Prograf-1"], "category": "Transplant immunosuppressant", "dosage": "1 mg", "frequency": "BID", "duration": "Long-term"},
    {"name": "Mycophenolate mofetil 500 mg", "generic": "MMF", "brands": ["Mycept", "Cellcept", "Mofetyl", "Myfortic"], "category": "Transplant immunosuppressant", "dosage": "500 mg", "frequency": "BID", "duration": "Long-term"},
    {"name": "Mycophenolate sodium 360 mg", "generic": "MPS", "brands": ["Myfortic"], "category": "Transplant immunosuppressant", "dosage": "360 mg", "frequency": "BID", "duration": "Long-term"},
    {"name": "Everolimus 0.25 mg", "generic": "Everolimus", "brands": ["Certican", "Evertor"], "category": "Transplant immunosuppressant", "dosage": "0.25 mg", "frequency": "BID", "duration": "Long-term"},
    {"name": "Prednisolone 5 mg (transplant)", "generic": "Prednisolone", "brands": ["Wysolone", "Omnacortil"], "category": "Transplant immunosuppressant", "dosage": "5 mg", "frequency": "OD", "duration": "Long-term", "timing": "After breakfast"},

    # --- IV fluids / peri-op (frequently prescribed) ---
    {"name": "Normal saline 0.9% 500 ml", "generic": "NaCl 0.9%", "brands": ["NS 500"], "category": "IV fluid", "dosage": "500 ml IV", "frequency": "As needed", "duration": "Peri-op"},
    {"name": "Ringer's lactate 500 ml", "generic": "RL", "brands": ["RL 500"], "category": "IV fluid", "dosage": "500 ml IV", "frequency": "As needed", "duration": "Peri-op"},
    {"name": "DNS 500 ml", "generic": "DNS", "brands": ["DNS 500"], "category": "IV fluid", "dosage": "500 ml IV", "frequency": "As needed", "duration": "Peri-op"},

    # --- Antacids / PPIs (co-prescribed with NSAIDs / steroids) ---
    {"name": "Pantoprazole 40 mg", "generic": "Pantoprazole", "brands": ["Pantop", "Pan-40", "Pantocid", "Pantosec"], "category": "PPI", "dosage": "40 mg", "frequency": "OD", "duration": "14 days", "timing": "Before breakfast"},
    {"name": "Rabeprazole 20 mg", "generic": "Rabeprazole", "brands": ["Razo", "Rabicip", "Pariet"], "category": "PPI", "dosage": "20 mg", "frequency": "OD", "duration": "14 days"},
    {"name": "Esomeprazole 40 mg", "generic": "Esomeprazole", "brands": ["Nexpro", "Esogard", "Esoz"], "category": "PPI", "dosage": "40 mg", "frequency": "OD", "duration": "14 days"},

    # --- Antiemetic (chemo / post-op) ---
    {"name": "Ondansetron 4 mg", "generic": "Ondansetron", "brands": ["Emeset", "Vomikind", "Zofer"], "category": "Antiemetic", "dosage": "4 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Ondansetron 8 mg", "generic": "Ondansetron", "brands": ["Emeset-8", "Vomikind-8"], "category": "Antiemetic", "dosage": "8 mg", "frequency": "BID", "duration": "3 days"},
    {"name": "Domperidone 10 mg", "generic": "Domperidone", "brands": ["Domstal", "Domperi", "Vomistop"], "category": "Antiemetic", "dosage": "10 mg", "frequency": "TID", "duration": "3 days"},
    {"name": "Metoclopramide 10 mg", "generic": "Metoclopramide", "brands": ["Perinorm", "Reglan", "Emnorm"], "category": "Antiemetic", "dosage": "10 mg", "frequency": "TID", "duration": "3 days"},

    # --- Laxatives (urology adjuncts) ---
    {"name": "Lactulose 15 ml", "generic": "Lactulose", "brands": ["Duphalac", "Looz", "Cremaffin Plus"], "category": "Laxative", "dosage": "15 ml", "frequency": "HS", "duration": "14 days"},
    {"name": "Bisacodyl 5 mg", "generic": "Bisacodyl", "brands": ["Dulcolax", "Laxoberry"], "category": "Laxative", "dosage": "5 mg", "frequency": "HS", "duration": "5 days"},
    {"name": "Isabgol husk", "generic": "Isabgol", "brands": ["Sat Isabgol", "Naturolax"], "category": "Laxative", "dosage": "1 tsp", "frequency": "HS", "duration": "30 days", "instructions": "Mix in water/milk; drink immediately."},

    # --- Vitamins (ED/fertility/transplant prophylaxis) ---
    {"name": "Vitamin D3 60,000 IU", "generic": "Cholecalciferol", "brands": ["Calcirol", "Uprise-D3", "D-Rise"], "category": "Vitamin", "dosage": "60000 IU", "frequency": "Weekly", "duration": "8 weeks"},
    {"name": "Vitamin B-complex", "generic": "B-complex", "brands": ["Becosules", "Neurobion Forte", "Methycobal"], "category": "Vitamin", "dosage": "1 cap", "frequency": "OD", "duration": "30 days"},
    {"name": "Methylcobalamin 1500 mcg", "generic": "Methylcobalamin", "brands": ["Mecobal", "Nervijen-Plus", "Nurokind"], "category": "Vitamin", "dosage": "1500 mcg", "frequency": "OD", "duration": "30 days"},
]


def get_medicine_catalog() -> List[Dict[str, Any]]:
    """Return a deep copy of the curated list."""
    return [dict(m) for m in UROLOGY_MEDICINES]
