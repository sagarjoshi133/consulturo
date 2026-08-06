"""
ConsultUro — Extended Patient Surgery Guides (Phase 5.6 — June 2026).

28 additional commonly-performed urology procedures, in the same
trilingual {en, hi, gu} schema as `data/guides.py`. Concise, bullet-
sized content optimised for mobile reading.

Reviewed by Dr. Sagar Joshi (Consultant Urologist).
For information only — not a substitute for in-person medical advice.
"""
from typing import Any, Dict, List


def _tri(en: str, hi: str, gu: str) -> Dict[str, str]:
    return {"en": en, "hi": hi, "gu": gu}


# Reusable building blocks (concise).
_FAST = _tri(
    "No solids 6 hrs before; clear fluids stop 2 hrs before.",
    "6 घंटे पहले ठोस आहार बंद; 2 घंटे पहले पानी बंद।",
    "6 કલાક પહેલા ઘન ખોરાક બંધ; 2 કલાક પહેલા પાણી બંધ.",
)
_STOP_BLOOD_THINNERS = _tri(
    "Stop blood thinners 5-7 days prior (confirm with cardiologist).",
    "खून पतला करने वाली दवाएँ 5-7 दिन पहले बंद करें (cardiologist से पुष्टि लें)।",
    "લોહી પાતળું કરનારી દવાઓ 5-7 દિવસ પહેલા બંધ કરો (cardiologist સાથે ખાતરી કરો).",
)
_URINE_CULTURE = _tri(
    "Urine culture must be sterile before surgery.",
    "सर्जरी से पहले urine culture sterile होना चाहिए।",
    "સર્જરી પહેલા urine culture sterile હોવો જોઈએ.",
)
_HYDRATE_PRE = _tri(
    "Drink 2 L water/day for 3 days before.",
    "सर्जरी से 3 दिन पहले रोज़ 2 लीटर पानी पिएँ।",
    "સર્જરી પહેલા 3 દિવસ દરરોજ 2 લિટર પાણી પીઓ.",
)
_WALK = _tri(
    "Walk 20-30 min daily from day 3.",
    "दिन 3 से रोज़ 20-30 मिनट चलें।",
    "દિવસ 3 થી દરરોજ 20-30 મિનિટ ચાલો.",
)
_FEVER_CALL = _tri(
    "Call us if fever >100°F or heavy bleeding.",
    "बुखार >100°F या ज़्यादा खून आए तो कॉल करें।",
    "તાવ >100°F કે વધારે રક્તસ્રાવ થાય તો કૉલ કરો.",
)
_NO_LIFT = _tri(
    "Don't lift >5 kg for 4 weeks.",
    "4 हफ्ते 5 kg से ज़्यादा वजन न उठाएँ।",
    "4 અઠવાડિયા 5 kg થી વધુ વજન ન ઉપાડો.",
)


GUIDES_EXTENDED: List[Dict[str, Any]] = [
    # ────────────── 1. HoLEP ──────────────
    {
        "key": "holep_full",
        "aliases": ["holep_laser", "thulep"],
        "name": _tri("HoLEP — Holmium Laser Prostate", "HoLEP — होल्मियम लेजर प्रोस्टेट", "HoLEP — હોલ્મિયમ લેઝર પ્રોસ્ટેટ"),
        "duration_minutes": 90, "hospital_stay_days": 2,
        "preop": [_STOP_BLOOD_THINNERS, _URINE_CULTURE, _HYDRATE_PRE, _FAST],
        "day_of": [
            _tri("Spinal or GA. Procedure 60-90 min.", "Spinal या GA। 60-90 मिनट।", "Spinal કે GA. 60-90 મિનિટ."),
            _tri("Laser removes prostate tissue through urethra — no external cuts.", "Laser से urethra से प्रोस्टेट निकाला जाता है — कोई बाहर का कट नहीं।", "Laser દ્વારા urethra થી પ્રોસ્ટેટ દૂર કરાય છે — બાહ્ય કટ નહીં."),
            _tri("Catheter for 1-2 days. Mild pink urine is normal.", "1-2 दिन catheter। हल्का गुलाबी पेशाब सामान्य है।", "1-2 દિવસ catheter. હળવો ગુલાબી પેશાબ સામાન્ય."),
        ],
        "postop": [
            _tri("Drink 2.5-3 L water/day for 2 weeks.", "2 हफ्ते रोज़ 2.5-3 L पानी पिएँ।", "2 અઠવાડિયા દરરોજ 2.5-3 L પાણી પીઓ."),
            _tri("Mild burning while urinating for 2-3 weeks is expected.", "2-3 हफ्ते हल्की जलन सामान्य है।", "2-3 અઠવાડિયા હળવી બળતરા સામાન્ય."),
            _tri("Retrograde ejaculation is common — harmless.", "Retrograde ejaculation आम है — नुकसानदायक नहीं।", "Retrograde ejaculation સામાન્ય — હાનિકારક નથી."),
        ],
        "diet": {
            "preop": [_tri("High-fibre diet 3 days before to prevent constipation.", "3 दिन पहले high-fibre आहार लें।", "3 દિવસ પહેલા high-fibre આહાર લો.")],
            "postop": [
                _tri("Soft khichdi/daliya/curd for first 3 days.", "पहले 3 दिन खिचड़ी/दलिया/दही।", "પ્રથમ 3 દિવસ ખીચડી/દળિયા/દહીં."),
                _tri("Avoid caffeine + spicy food for 2 weeks.", "2 हफ्ते caffeine + तीखा भोजन न लें।", "2 અઠવાડિયા caffeine + તીખું ન લો."),
            ],
        },
        "recovery_milestones": [
            {"day": 2, **_tri("Catheter removed. Discharge.", "Catheter निकलेगा। Discharge।", "Catheter નીકળશે. Discharge.")},
            {"day": 7, **_tri("Desk work resumed. Light walks daily.", "Desk work शुरू। रोज़ हल्की walk।", "Desk work શરૂ. દરરોજ હળવી walk.")},
            {"day": 30, **_tri("Most symptoms settled. Return to gym/work fully.", "ज़्यादातर symptoms ठीक। पूरा काम/gym शुरू।", "મોટાભાગના symptoms ઠીક. પૂરું કામ/gym શરૂ.")},
        ],
        "dos_donts": {
            "dos": [_tri("Drink 2.5-3 L water daily.", "रोज़ 2.5-3 L पानी पिएँ।", "દરરોજ 2.5-3 L પાણી પીઓ."), _WALK],
            "donts": [_NO_LIFT, _FEVER_CALL],
        },
    },

    # ────────────── 2. RIRS ──────────────
    {
        "key": "rirs",
        "aliases": ["flexible_urs", "fursl_rirs"],
        "name": _tri("RIRS — Flexible Ureteroscopy for Kidney Stones", "RIRS — गुर्दे की पथरी के लिए Flexible Ureteroscopy", "RIRS — કિડની પથરી માટે Flexible Ureteroscopy"),
        "duration_minutes": 60, "hospital_stay_days": 1,
        "preop": [_URINE_CULTURE, _STOP_BLOOD_THINNERS, _FAST,
                  _tri("CT KUB within 2 weeks to plan stone access.", "Stone access plan करने के लिए 2 हफ्ते में CT KUB।", "Stone access plan કરવા 2 અઠવાડિયામાં CT KUB.")],
        "day_of": [
            _tri("Spinal/GA. Procedure 45-60 min via flexible scope.", "Spinal/GA। Flexible scope से 45-60 मिनट।", "Spinal/GA. Flexible scope થી 45-60 મિનિટ."),
            _tri("Laser fragments stones; pieces removed or left to pass.", "Laser से पथरी को तोड़ा जाता है; टुकड़े निकालते हैं या निकलने देते हैं।", "Laser થી પથરી તોડાય; ટુકડા કાઢે કે નીકળવા દે."),
            _tri("DJ stent placed; stays 1-2 weeks.", "DJ stent डाला जाता है, 1-2 हफ्ते रहता है।", "DJ stent મુકાય, 1-2 અઠવાડિયા રહે છે."),
        ],
        "postop": [
            _tri("Same/next-day discharge. Resume desk work in 2-3 days.", "उसी/अगले दिन discharge। 2-3 दिन में desk work।", "તે જ/બીજા દિવસે discharge. 2-3 દિવસમાં desk work."),
            _tri("Stent symptoms (urgency, pink urine) settle with water + medicine.", "Stent symptoms (urgency, गुलाबी पेशाब) पानी + दवा से ठीक।", "Stent symptoms (urgency, ગુલાબી પેશાબ) પાણી + દવા થી ઠીક."),
            _tri("Stent removal in OPD after 1-2 weeks.", "OPD में 1-2 हफ्ते बाद stent निकलेगा।", "OPD માં 1-2 અઠવાડિયા પછી stent નીકળશે."),
        ],
        "diet": {
            "preop": [_tri("Light dinner night before. Hydrate well.", "रात पहले हल्का dinner। पानी अच्छे से।", "આગલી રાત હળવું dinner. પાણી સારી રીતે.")],
            "postop": [
                _tri("3 L water/day until stent out. Add lemon.", "Stent निकलने तक रोज़ 3 L पानी + नींबू।", "Stent નીકળે ત્યાં સુધી દરરોજ 3 L પાણી + લીંબુ."),
                _tri("Avoid spinach, beetroot, peanuts, strong tea.", "पालक, चुकंदर, मूँगफली, गहरी चाय न लें।", "પાલક, બીટ, મગફળી, ગાઢી ચા ન લો."),
                _tri("Coconut water + cucumber + watermelon recommended.", "नारियल पानी + खीरा + तरबूज़ अच्छे हैं।", "નારિયેળ પાણી + કાકડી + તરબૂચ સારા છે."),
            ],
        },
        "recovery_milestones": [
            {"day": 1, **_tri("Discharge same/next day.", "उसी/अगले दिन discharge।", "તે જ/બીજા દિવસે discharge.")},
            {"day": 3, **_tri("Desk work + light activity OK.", "Desk + हल्की activity ठीक।", "Desk + હળવી activity ઠીક.")},
            {"day": 14, **_tri("DJ stent removed in OPD.", "OPD में stent निकलेगा।", "OPD માં stent નીકળશે.")},
            {"day": 28, **_tri("Ultrasound + stone-analysis discussion.", "Ultrasound + पथरी analysis पर बातचीत।", "Ultrasound + પથરી analysis ની ચર્ચા.")},
        ],
        "dos_donts": {
            "dos": [_tri("Drink water + lemon liberally.", "खूब पानी + नींबू।", "ખૂબ પાણી + લીંબુ."), _WALK],
            "donts": [_tri("Don't miss stent removal date.", "Stent date न भूलें।", "Stent date ન ભૂલો."), _FEVER_CALL],
        },
    },

    # ────────────── 3. Cystoscopy ──────────────
    {
        "key": "cystoscopy",
        "aliases": ["check_cysto", "diagnostic_cysto"],
        "name": _tri("Cystoscopy — Bladder Inspection", "Cystoscopy — Bladder जाँच", "Cystoscopy — Bladder તપાસ"),
        "duration_minutes": 15, "hospital_stay_days": 0,
        "preop": [_URINE_CULTURE, _tri("Eat normally. Hydrate well.", "सामान्य भोजन। पानी पिएँ।", "સામાન્ય ભોજન. પાણી પીઓ.")],
        "day_of": [
            _tri("Done in OPD under local anaesthetic gel. 5-10 min.", "OPD में local gel से 5-10 मिनट।", "OPD માં local gel થી 5-10 મિનિટ."),
            _tri("Thin scope passes through urethra to bladder.", "Urethra से एक पतला scope bladder तक जाता है।", "Urethra થી પાતળું scope bladder સુધી જાય."),
            _tri("Mild burning during/after — short-lived.", "थोड़ी जलन हो सकती है — जल्दी ठीक।", "થોડી બળતરા થઈ શકે — ઝડપથી ઠીક."),
        ],
        "postop": [
            _tri("Drink 2 L water in next 24 hrs to flush.", "अगले 24 घंटे में 2 L पानी पिएँ।", "પછીના 24 કલાકમાં 2 L પાણી પીઓ."),
            _tri("Pink-tinged urine for 1-2 voids is normal.", "1-2 पेशाब में हल्का गुलाबी रंग सामान्य।", "1-2 પેશાબમાં હળવો ગુલાબી રંગ સામાન્ય."),
            _tri("Resume all activities the same day.", "उसी दिन सब काम कर सकते हैं।", "તે જ દિવસે બધી પ્રવૃત્તિ ઠીક."),
        ],
        "diet": {
            "preop": [],
            "postop": [_tri("Normal diet. Lots of water for 24 hrs.", "सामान्य आहार। 24 घंटे ज़्यादा पानी।", "સામાન્ય આહાર. 24 કલાક વધારે પાણી.")],
        },
        "recovery_milestones": [
            {"day": 0, **_tri("Go home same day.", "उसी दिन घर।", "તે જ દિવસે ઘરે.")},
            {"day": 1, **_tri("Symptoms settle. Resume work.", "Symptoms ठीक। काम शुरू।", "Symptoms ઠીક. કામ શરૂ.")},
        ],
        "dos_donts": {
            "dos": [_tri("Hydrate well for 24 hrs.", "24 घंटे पानी पिएँ।", "24 કલાક પાણી પીઓ.")],
            "donts": [_tri("Don't worry about mild pink urine.", "हल्के गुलाबी पेशाब से न घबराएँ।", "હળવા ગુલાબી પેશાબથી ગભરાશો નહીં."), _FEVER_CALL],
        },
    },

    # ────────────── 4. DJ Stent Insertion/Removal ──────────────
    {
        "key": "dj_stent",
        "aliases": ["double_j", "dj_insertion", "stent_removal"],
        "name": _tri("DJ Stent — Insertion / Removal", "DJ Stent — डालना / निकालना", "DJ Stent — મુકવું / દૂર કરવું"),
        "duration_minutes": 15, "hospital_stay_days": 0,
        "preop": [_URINE_CULTURE, _tri("Eat lightly the day of procedure.", "Procedure वाले दिन हल्का खाएँ।", "Procedure ના દિવસે હળવું ખાવ.")],
        "day_of": [
            _tri("Local + short anaesthesia. 10-15 min in OT.", "Local + short anaesthesia। OT में 10-15 मिनट।", "Local + short anaesthesia. OT માં 10-15 મિનિટ."),
            _tri("No external cuts. Scope passes via urethra.", "कोई बाहर का कट नहीं। Scope urethra से।", "બાહ્ય કટ નહીં. Scope urethra થી."),
        ],
        "postop": [
            _tri("Stent in place causes mild urgency + pink urine — normal.", "Stent से हल्की urgency + गुलाबी पेशाब — सामान्य।", "Stent થી હળવી urgency + ગુલાબી પેશાબ — સામાન્ય."),
            _tri("Drink 2.5 L water/day while stent is in.", "Stent रहते हुए रोज़ 2.5 L पानी।", "Stent હોય ત્યારે દરરોજ 2.5 L પાણી."),
            _tri("Resume work next day. Don't miss removal date!", "अगले दिन काम। निकलने की date न भूलें!", "બીજા દિવસે કામ. દૂર કરવાની date ન ભૂલો!"),
        ],
        "diet": {
            "preop": [],
            "postop": [_tri("Normal diet + plenty of water. Limit caffeine.", "सामान्य भोजन + खूब पानी। Caffeine कम।", "સામાન્ય ભોજન + ખૂબ પાણી. Caffeine ઓછું.")],
        },
        "recovery_milestones": [
            {"day": 0, **_tri("Same-day discharge.", "उसी दिन discharge।", "તે જ દિવસે discharge.")},
            {"day": 14, **_tri("Stent removed at next OPD visit.", "अगली OPD visit पर stent निकलेगा।", "આગલી OPD visit પર stent નીકળશે.")},
        ],
        "dos_donts": {
            "dos": [_tri("Hydrate well.", "खूब पानी।", "ખૂબ પાણી.")],
            "donts": [_tri("Don't forget stent-removal date.", "Stent date न भूलें।", "Stent date ન ભૂલો."), _FEVER_CALL],
        },
    },

    # ────────────── 5. ESWL ──────────────
    {
        "key": "eswl",
        "aliases": ["shockwave", "lithotripsy"],
        "name": _tri("ESWL — Shockwave Lithotripsy", "ESWL — Shockwave से पथरी तोड़ना", "ESWL — Shockwave દ્વારા પથરી તોડવી"),
        "duration_minutes": 45, "hospital_stay_days": 0,
        "preop": [_URINE_CULTURE, _STOP_BLOOD_THINNERS,
                  _tri("Recent X-ray/CT KUB to confirm stone visibility.", "ताज़ा X-ray/CT KUB से पथरी confirm करें।", "તાજો X-ray/CT KUB થી પથરી confirm કરો."),
                  _tri("Light breakfast on procedure day.", "Procedure वाले दिन हल्का breakfast।", "Procedure ના દિવસે હળવો breakfast.")],
        "day_of": [
            _tri("Done in OPD/Day-care with light sedation. 30-45 min.", "OPD में light sedation से 30-45 मिनट।", "OPD માં light sedation થી 30-45 મિનિટ."),
            _tri("No incision. Shockwaves break stone from outside.", "कोई चीरा नहीं। बाहर से shockwaves पथरी तोड़ती हैं।", "ચીરો નહીં. બહારથી shockwaves પથરી તોડે છે."),
            _tri("Discharged same day. Mild flank ache for 1-2 days.", "उसी दिन discharge। 1-2 दिन हल्की कमर दर्द।", "તે જ દિવસે discharge. 1-2 દિવસ હળવી કમર પીડા."),
        ],
        "postop": [
            _tri("Drink 3 L water/day to flush stone fragments.", "पथरी के टुकड़े निकालने 3 L पानी रोज़।", "પથરી ના ટુકડા કાઢવા દરરોજ 3 L પાણી."),
            _tri("Strain urine in muslin cloth — collect fragments.", "मलमल कपड़े से पेशाब छानें — टुकड़े जमा करें।", "મલમલના કાપડથી પેશાબ ગાળો — ટુકડા એકઠા કરો."),
            _tri("Mild blood in urine for 1-2 days is normal.", "1-2 दिन पेशाब में हल्का खून सामान्य।", "1-2 દિવસ પેશાબમાં હળવું રક્ત સામાન્ય."),
        ],
        "diet": {
            "preop": [_tri("Stay hydrated 3 days before.", "3 दिन पहले पानी पिएँ।", "3 દિવસ પહેલા પાણી પીઓ.")],
            "postop": [
                _tri("3 L water + lemon daily.", "रोज़ 3 L पानी + नींबू।", "દરરોજ 3 L પાણી + લીંબુ."),
                _tri("Avoid spinach, beetroot, nuts.", "पालक, चुकंदर, मेवे न लें।", "પાલક, બીટ, મેવા ન લો."),
            ],
        },
        "recovery_milestones": [
            {"day": 0, **_tri("Discharge same day. Rest at home.", "उसी दिन discharge। घर पर आराम।", "તે જ દિવસે discharge. ઘરે આરામ.")},
            {"day": 14, **_tri("Repeat X-ray/USG to check stone clearance.", "Stone clearance के लिए दुबारा X-ray/USG।", "Stone clearance માટે ફરી X-ray/USG.")},
        ],
        "dos_donts": {
            "dos": [_tri("Drink heavily. Strain urine for fragments.", "खूब पानी। पेशाब छानें।", "ખૂબ પાણી. પેશાબ ગાળો."), _WALK],
            "donts": [_tri("Don't exercise heavily for 1 week.", "1 हफ्ते भारी exercise न करें।", "1 અઠવાડિયું ભારે કસરત ન કરો."), _FEVER_CALL],
        },
    },

    # ────────────── 6. TURBT ──────────────
    {
        "key": "turbt",
        "aliases": ["bladder_tumor_resection"],
        "name": _tri("TURBT — Bladder Tumor Resection", "TURBT — Bladder Tumor निकालना", "TURBT — Bladder Tumor દૂર કરવું"),
        "duration_minutes": 60, "hospital_stay_days": 2,
        "preop": [_STOP_BLOOD_THINNERS, _URINE_CULTURE, _HYDRATE_PRE, _FAST],
        "day_of": [
            _tri("Spinal/GA. 45-60 min via cystoscope.", "Spinal/GA। Cystoscope से 45-60 मिनट।", "Spinal/GA. Cystoscope થી 45-60 મિનિટ."),
            _tri("Tumour removed; sent for biopsy.", "Tumour निकालकर biopsy भेजी जाती है।", "Tumour દૂર કરી biopsy મોકલાય."),
            _tri("Catheter for 1-2 days; bladder irrigation may run.", "1-2 दिन catheter; bladder wash चल सकती है।", "1-2 દિવસ catheter; bladder wash ચાલી શકે."),
        ],
        "postop": [
            _tri("Drink 2.5 L water/day for 2 weeks.", "2 हफ्ते रोज़ 2.5 L पानी।", "2 અઠવાડિયા દરરોજ 2.5 L પાણી."),
            _tri("Pink urine for 1 week is normal.", "1 हफ्ते गुलाबी पेशाब सामान्य।", "1 અઠવાડિયું ગુલાબી પેશાબ સામાન્ય."),
            _tri("Biopsy results in 7-10 days — guides further treatment.", "Biopsy 7-10 दिन में आती है — आगे की treatment तय।", "Biopsy 7-10 દિવસમાં — આગળની treatment નક્કી."),
        ],
        "diet": {
            "preop": [],
            "postop": [
                _tri("Avoid spicy/caffeinated drinks for 2 weeks.", "2 हफ्ते तीखा/caffeine न लें।", "2 અઠવાડિયા તીખું/caffeine ન લો."),
                _tri("Soft, fibre-rich foods.", "नरम, fibre वाले foods।", "નરમ, fibre વાળું ખોરાક."),
            ],
        },
        "recovery_milestones": [
            {"day": 2, **_tri("Catheter removed. Discharge.", "Catheter निकलेगा। Discharge।", "Catheter નીકળશે. Discharge.")},
            {"day": 10, **_tri("Biopsy results reviewed in OPD.", "OPD में biopsy review।", "OPD માં biopsy review.")},
            {"day": 90, **_tri("Surveillance cystoscopy at 3 months.", "3 महीने पर surveillance cystoscopy।", "3 મહિને surveillance cystoscopy.")},
        ],
        "dos_donts": {
            "dos": [_tri("Attend every follow-up cystoscopy.", "हर follow-up cystoscopy ज़रूर करें।", "દરેક follow-up cystoscopy કરો."), _tri("Quit smoking — single biggest risk factor.", "Smoking बंद करें — सबसे बड़ा risk।", "Smoking બંધ કરો — સૌથી મોટું risk.")],
            "donts": [_NO_LIFT, _FEVER_CALL],
        },
    },

    # ────────────── 7. Radical Cystectomy ──────────────
    {
        "key": "radical_cystectomy",
        "aliases": ["bladder_removal", "rc"],
        "name": _tri("Radical Cystectomy — Bladder Removal", "Radical Cystectomy — Bladder निकालना", "Radical Cystectomy — Bladder દૂર કરવું"),
        "duration_minutes": 360, "hospital_stay_days": 10,
        "preop": [
            _STOP_BLOOD_THINNERS, _URINE_CULTURE,
            _tri("Cardiac + pulmonary clearance required.", "Cardiac + pulmonary clearance ज़रूरी।", "Cardiac + pulmonary clearance જરૂરી."),
            _tri("Stoma nurse counselling if urinary diversion planned.", "Urinary diversion हो तो stoma nurse counselling।", "Urinary diversion હોય તો stoma nurse counselling."),
            _tri("Bowel prep evening before per surgeon advice.", "एक रात पहले bowel prep।", "આગલી રાત bowel prep."),
        ],
        "day_of": [
            _tri("GA. 5-7 hour surgery — bladder + lymph nodes removed.", "GA। 5-7 घंटे — bladder + lymph nodes निकाले।", "GA. 5-7 કલાક — bladder + lymph nodes દૂર."),
            _tri("Urinary diversion done (ileal conduit or neobladder).", "Urinary diversion (ileal conduit/neobladder) बनाई।", "Urinary diversion (ileal conduit/neobladder) બનાવાય."),
            _tri("ICU stay overnight is routine.", "Routine ICU stay 1 रात।", "Routine ICU stay 1 રાત."),
        ],
        "postop": [
            _tri("Walk same day in ICU. Early mobilisation matters.", "ICU में उसी दिन चलना ज़रूरी।", "ICU માં તે જ દિવસે ચાલવું જરૂરી."),
            _tri("Diet advances slowly: clear fluids → soft → normal over 5 days.", "खाना धीरे-धीरे: 5 दिन में normal।", "ખોરાક ધીમે: 5 દિવસમાં normal."),
            _tri("Stoma care training before discharge (if applicable).", "Discharge से पहले stoma care सीखें।", "Discharge પહેલા stoma care શીખો."),
            _tri("Hospital stay 8-12 days. Recovery 6-8 weeks.", "8-12 दिन hospital। 6-8 हफ्ते recovery।", "8-12 દિવસ hospital. 6-8 અઠવાડિયા recovery."),
        ],
        "diet": {
            "preop": [_tri("High-protein diet 2 weeks before for healing.", "2 हफ्ते पहले high-protein आहार।", "2 અઠવાડિયા પહેલા high-protein આહાર.")],
            "postop": [
                _tri("Small frequent meals (6/day) first 4 weeks.", "पहले 4 हफ्ते छोटे-छोटे 6 meals।", "પ્રથમ 4 અઠવાડિયા નાના 6 meals."),
                _tri("Protein 1-1.2 g/kg body weight. Eggs, dal, paneer, fish.", "Protein 1-1.2 g/kg। अंडे, दाल, पनीर, मछली।", "Protein 1-1.2 g/kg. ઈંડા, દાળ, પનીર, માછલી."),
                _tri("Hydrate well — 2.5 L water/day. Watch stoma output.", "2.5 L पानी रोज़। Stoma output देखें।", "2.5 L પાણી દરરોજ. Stoma output જુઓ."),
            ],
        },
        "recovery_milestones": [
            {"day": 5, **_tri("Normal diet resumed.", "Normal diet शुरू।", "Normal diet શરૂ.")},
            {"day": 10, **_tri("Discharge with stoma care plan.", "Stoma care plan के साथ discharge।", "Stoma care plan સાથે discharge.")},
            {"day": 30, **_tri("Stitches out. Return to light work.", "टांके निकले। हल्का काम।", "ટાંકા નીકળ્યા. હળવું કામ.")},
            {"day": 90, **_tri("Full recovery. Quarterly oncology follow-up.", "पूरी recovery। हर 3 महीने oncology follow-up।", "પૂરી recovery. દર 3 મહિને oncology follow-up.")},
        ],
        "dos_donts": {
            "dos": [_tri("Walk daily from day 1.", "दिन 1 से रोज़ चलें।", "દિવસ 1 થી દરરોજ ચાલો."), _tri("Attend all oncology follow-ups.", "हर oncology follow-up पर जाएँ।", "દરેક oncology follow-up માં જાઓ.")],
            "donts": [_NO_LIFT, _tri("Don't ignore stoma redness/swelling/leakage.", "Stoma redness/swelling/leakage नज़रअंदाज़ न करें।", "Stoma redness/swelling/leakage અવગણશો નહીં.")],
        },
    },

    # ────────────── 8. Radical Prostatectomy ──────────────
    {
        "key": "radical_prostatectomy",
        "aliases": ["rarp", "rrp", "lrp"],
        "name": _tri("Radical Prostatectomy — Prostate Cancer Surgery", "Radical Prostatectomy — Prostate Cancer सर्जरी", "Radical Prostatectomy — Prostate Cancer સર્જરી"),
        "duration_minutes": 240, "hospital_stay_days": 4,
        "preop": [_STOP_BLOOD_THINNERS, _URINE_CULTURE,
                  _tri("Kegel exercises 2 weeks before to strengthen pelvic floor.", "Pelvic floor strong करने 2 हफ्ते Kegel exercises।", "Pelvic floor strong કરવા 2 અઠવાડિયા Kegel exercises."),
                  _FAST],
        "day_of": [
            _tri("GA. Robotic or open: 3-4 hours.", "GA। Robotic या open: 3-4 घंटे।", "GA. Robotic કે open: 3-4 કલાક."),
            _tri("Prostate + seminal vesicles removed; nerves spared if possible.", "Prostate + seminal vesicles निकाले; nerves बचाते हैं।", "Prostate + seminal vesicles દૂર; nerves બચાવાય."),
            _tri("Catheter stays 7-14 days.", "Catheter 7-14 दिन।", "Catheter 7-14 દિવસ."),
        ],
        "postop": [
            _tri("Walk day 1. Discharge day 3-4.", "दिन 1 से चलें। दिन 3-4 discharge।", "દિવસ 1 થી ચાલો. દિવસ 3-4 discharge."),
            _tri("Catheter care — keep clean & taped to thigh.", "Catheter साफ रखें, जांघ से tape।", "Catheter સાફ રાખો, જાંઘ થી tape."),
            _tri("Continence: most regain by 3-6 months — Kegel daily.", "Continence: 3-6 महीने में वापस। रोज़ Kegel।", "Continence: 3-6 મહિને પાછું. દરરોજ Kegel."),
            _tri("Erectile recovery: 6-18 months. Penile rehab from week 6.", "Erection: 6-18 महीने में वापस। Week 6 से rehab।", "Erection: 6-18 મહિને પાછું. Week 6 થી rehab."),
        ],
        "diet": {
            "preop": [_tri("High-protein diet 1 week before.", "1 हफ्ते high-protein आहार।", "1 અઠવાડિયું high-protein આહાર.")],
            "postop": [
                _tri("Fibre + fluids to prevent constipation (catheter discomfort).", "Constipation रोकने fibre + पानी।", "Constipation અટકાવવા fibre + પાણી."),
                _tri("Lean protein for healing. Limit red meat & dairy if PSA high.", "Healing के लिए lean protein। PSA high हो तो red meat & dairy कम।", "Healing માટે lean protein. PSA વધારે હોય તો red meat & dairy ઓછું."),
            ],
        },
        "recovery_milestones": [
            {"day": 4, **_tri("Discharge home with catheter.", "Catheter के साथ discharge।", "Catheter સાથે discharge.")},
            {"day": 14, **_tri("Catheter removed in OPD. First PSA at 6 weeks.", "OPD में catheter निकलेगा। 6 हफ्ते बाद PSA।", "OPD માં catheter નીકળશે. 6 અઠવાડિયા પછી PSA.")},
            {"day": 90, **_tri("Most regain continence. PSA every 3 months.", "Continence वापस। हर 3 महीने PSA।", "Continence પાછું. દર 3 મહિને PSA.")},
        ],
        "dos_donts": {
            "dos": [_tri("Do Kegels 3 times/day.", "रोज़ 3 बार Kegel।", "દરરોજ 3 વાર Kegel."), _WALK],
            "donts": [_NO_LIFT, _tri("Don't skip PSA tests.", "PSA test न छोड़ें।", "PSA test ન છોડો.")],
        },
    },

    # ────────────── 9. Radical Nephrectomy ──────────────
    {
        "key": "radical_nephrectomy",
        "aliases": ["lap_nephrectomy", "open_radical_nephrectomy"],
        "name": _tri("Radical Nephrectomy — Kidney Removal", "Radical Nephrectomy — गुर्दा निकालना", "Radical Nephrectomy — કિડની દૂર કરવી"),
        "duration_minutes": 180, "hospital_stay_days": 5,
        "preop": [_STOP_BLOOD_THINNERS,
                  _tri("Renal scan to confirm other kidney function.", "दूसरे गुर्दे की function check के लिए renal scan।", "બીજી કિડની function check માટે renal scan."),
                  _tri("Cardiac clearance.", "Cardiac clearance।", "Cardiac clearance."),
                  _FAST],
        "day_of": [
            _tri("GA. Laparoscopic 2.5 hrs / open 3 hrs.", "GA। Laparoscopic 2.5 घंटे / open 3 घंटे।", "GA. Laparoscopic 2.5 કલાક / open 3 કલાક."),
            _tri("Entire kidney + adrenal (if needed) + nodes removed.", "पूरा गुर्दा + adrenal (अगर ज़रूरी) + nodes।", "પૂરી કિડની + adrenal (જરૂર પડે) + nodes."),
            _tri("Drain + urinary catheter 1-2 days.", "Drain + catheter 1-2 दिन।", "Drain + catheter 1-2 દિવસ."),
        ],
        "postop": [
            _tri("Walk same day. Discharge day 4-5.", "उसी दिन चलें। दिन 4-5 discharge।", "તે જ દિવસે ચાલો. દિવસ 4-5 discharge."),
            _tri("Other kidney compensates — function recovers fully.", "दूसरा गुर्दा compensate करता है — function पूरी।", "બીજી કિડની compensate કરે છે."),
            _tri("Avoid NSAIDs (Brufen) for life — use paracetamol.", "NSAIDs (Brufen) ज़िंदगी भर न लें — paracetamol लें।", "NSAIDs (Brufen) જીવનભર ન લો — paracetamol લો."),
        ],
        "diet": {
            "preop": [_tri("Normal balanced diet.", "Normal संतुलित diet।", "Normal સંતુલિત diet.")],
            "postop": [
                _tri("Hydration: 2 L water/day. Don't over-hydrate.", "2 L पानी रोज़। ज़्यादा भी न पिएँ।", "2 L પાણી દરરોજ. વધારે ન પીઓ."),
                _tri("Moderate protein. Salt < 5g/day to protect remaining kidney.", "Moderate protein। नमक <5g रोज़।", "Moderate protein. મીઠું <5g રોજ."),
                _tri("Annual BP + creatinine check.", "हर साल BP + creatinine check।", "દર વર્ષે BP + creatinine check."),
            ],
        },
        "recovery_milestones": [
            {"day": 5, **_tri("Discharge.", "Discharge।", "Discharge.")},
            {"day": 14, **_tri("Stitches out. Light walking.", "टांके निकले। हल्की walk।", "ટાંકા નીકળ્યા. હળવી walk.")},
            {"day": 30, **_tri("Resume desk work fully.", "Desk work पूरा शुरू।", "Desk work પૂરું શરૂ.")},
            {"day": 90, **_tri("Full activity + first oncology follow-up.", "पूरी activity + oncology follow-up।", "પૂરી activity + oncology follow-up.")},
        ],
        "dos_donts": {
            "dos": [_tri("Monitor BP at home monthly.", "हर महीने BP check।", "દર મહિને BP check."), _tri("Annual renal function test.", "हर साल kidney test।", "દર વર્ષે kidney test.")],
            "donts": [_tri("Never take NSAIDs again.", "NSAIDs कभी न लें।", "NSAIDs ક્યારેય ન લો."), _NO_LIFT],
        },
    },

    # ────────────── 10. Partial Nephrectomy ──────────────
    {
        "key": "partial_nephrectomy",
        "aliases": ["nephron_sparing", "tumour_excision_kidney"],
        "name": _tri("Partial Nephrectomy — Kidney-Sparing Tumor Removal", "Partial Nephrectomy — Tumor निकालना (गुर्दा बचाकर)", "Partial Nephrectomy — Tumor દૂર (કિડની બચાવી)"),
        "duration_minutes": 210, "hospital_stay_days": 5,
        "preop": [_STOP_BLOOD_THINNERS, _tri("Detailed CT angio to map vessels.", "Vessels map करने CT angio।", "Vessels map કરવા CT angio."), _FAST],
        "day_of": [
            _tri("GA. Robotic/lap 3-4 hrs. Only tumor + small margin removed.", "GA। Robotic/lap 3-4 घंटे। केवल tumor + किनारा।", "GA. Robotic/lap 3-4 કલાક. ફક્ત tumor + કિનારી."),
            _tri("Kidney function preserved.", "गुर्दे की function बची रहती है।", "કિડની function બચે છે."),
        ],
        "postop": [
            _tri("Hospital 4-5 days. Drain removed in 2 days.", "4-5 दिन hospital। 2 दिन में drain।", "4-5 દિવસ hospital. 2 દિવસમાં drain."),
            _tri("Watch for delayed bleeding — first 2-4 weeks.", "2-4 हफ्ते late bleeding पर नज़र।", "2-4 અઠવાડિયા late bleeding પર નજર."),
        ],
        "diet": {
            "preop": [],
            "postop": [_tri("Normal balanced diet. 2 L water/day.", "Normal diet। 2 L पानी।", "Normal diet. 2 L પાણી.")],
        },
        "recovery_milestones": [
            {"day": 5, **_tri("Discharge.", "Discharge।", "Discharge.")},
            {"day": 14, **_tri("Stitches out.", "टांके निकले।", "ટાંકા નીકળ્યા.")},
            {"day": 90, **_tri("CT at 3 months for recurrence check.", "3 महीने पर CT।", "3 મહિને CT.")},
        ],
        "dos_donts": {
            "dos": [_tri("Walk daily. Annual scan.", "रोज़ चलें। हर साल scan।", "દરરોજ ચાલો. દર વર્ષે scan.")],
            "donts": [_NO_LIFT, _FEVER_CALL],
        },
    },
]
