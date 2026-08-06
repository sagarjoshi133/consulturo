"""
ConsultUro — Surgical Consent Templates Database

50 most commonly performed urology surgeries, fully trilingual
(EN / HI / GU). Each template carries:

  - key           : stable identifier used by frontend + DB
  - category      : grouping for UI picker ("Endourology", "Open Surgery",
                    "Reconstruction", "Andrology", "Transplant",
                    "Oncology", "Functional", "Minor Procedure")
  - anesthesia    : suggested anaesthesia (spinal / GA / LA / sedation)
  - name          : {en, hi, gu}
  - procedure     : {en, hi, gu}  — 1-2 sentence layperson description
  - specific_risks: list of {en, hi, gu}  — procedure-specific risks
                    (common risks like bleeding/infection/anaesthesia
                    are added by the frontend boilerplate so they aren't
                    duplicated here)
  - alternatives  : {en, hi, gu}  — non-surgical or alternative options

DESIGN NOTES:
  - Hindi text uses Devanagari, Gujarati uses Gujarati script.
  - The procedure text is intentionally concise — a typical fully-
    composed consent form pulls in headers, anaesthesia text and
    common-risks boilerplate from the frontend i18n bundles to
    keep this file maintainable (~50KB).
  - Each procedure carries 3-5 specific risks. The most clinically
    important risks per procedure are listed first.
  - For super-owner admin editing later we expose this list via
    /api/surgical-consents/procedures so the UI can refresh without
    a code deploy. (Edit-flow itself is out of scope for v1 — but
    the read endpoint is the seed.)
"""
from typing import Dict, List, Any


# Common boilerplate keys the FRONTEND turns into full sentences (so
# Dr. Joshi can tweak the wording app-wide from one place rather than
# editing 50 procedures).
COMMON_BOILERPLATE_KEYS = [
    "ANAESTHESIA_RISKS",
    "BLEEDING_RISK",
    "INFECTION_RISK",
    "PAIN_RISK",
    "DVT_PE_RISK",
    "ALLERGIC_REACTION",
    "NEED_REOPERATION",
    "DAMAGE_ADJACENT_ORGAN",
    "CONVERSION_TO_OPEN",
    "BLOOD_TRANSFUSION",
    "PROLONGED_STAY",
    "READMISSION_RISK",
]


PROCEDURES: List[Dict[str, Any]] = [
    # ─────────── ENDOUROLOGY ───────────
    {
        "key": "turp",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": {
            "en": "Transurethral Resection of the Prostate (TURP)",
            "hi": "प्रोस्टेट का ट्रांस-यूरेथ्रल रिसेक्शन (TURP)",
            "gu": "પ્રોસ્ટેટનું ટ્રાન્સ-યુરેથ્રલ રિસેક્શન (TURP)",
        },
        "procedure": {
            "en": "Endoscopic removal of obstructing prostate tissue through the urethra using an electrocautery loop. No external cut. A urethral catheter remains for 2-3 days.",
            "hi": "Urethra के रास्ते electrocautery loop का इस्तेमाल करके, prostate में रुकावट पैदा करने वाले tissue को एंडोस्कोपी से हटाया जाता है। बाहर से कोई कट नहीं लगता। Urethral catheter 2-3 दिन तक लगा रहेगा।",
            "gu": "Urethra દ્વારા electrocautery loop નો ઉપયોગ કરીને, prostate માં અવરોધ પેદા કરતા tissue ને endoscopy થી દૂર કરવામાં આવે છે. કોઈ બાહ્ય cut લાગતો નથી. Urethral catheter 2-3 દિવસ સુધી લગાડેલો રહેશે.",
        },
        "specific_risks": [
            {
                "en": "Retrograde ejaculation (60–80%) — semen passes into the bladder during ejaculation; not harmful but affects fertility.",
                "hi": "रिट्रोग्रेड स्खलन (60–80%) — स्खलन के समय वीर्य मूत्राशय में जाता है; यह हानिकारक नहीं है लेकिन प्रजनन क्षमता प्रभावित होती है।",
                "gu": "રિટ્રોગ્રેડ સ્ખલન (60–80%) — સ્ખલન સમયે વીર્ય મૂત્રાશયમાં જાય છે; તે હાનિકારક નથી પણ પ્રજનનક્ષમતા પર અસર થાય છે.",
            },
            {
                "en": "Urinary incontinence (1–2%) — usually temporary, may rarely be long-term.",
                "hi": "मूत्र असंयम (1–2%) — आमतौर पर अस्थायी, शायद ही कभी दीर्घकालिक।",
                "gu": "મૂત્ર અસંયમ (1–2%) — સામાન્ય રીતે કામચલાઉ, ભાગ્યે જ લાંબા ગાળાનું.",
            },
            {
                "en": "Urethral stricture (3–5%) — narrowing of the urinary passage that may need future dilatation.",
                "hi": "मूत्रमार्ग संकुचन (3–5%) — मूत्र मार्ग का संकीर्ण होना जिसके लिए भविष्य में फैलाव की आवश्यकता हो सकती है।",
                "gu": "મૂત્રમાર્ગ સંકોચન (3–5%) — મૂત્રમાર્ગ સાંકડો થવો, ભવિષ્યમાં ફેલાવણીની જરૂર પડી શકે છે.",
            },
            {
                "en": "TUR syndrome (rare) — absorption of irrigation fluid; may need close monitoring.",
                "hi": "TUR सिंड्रोम (दुर्लभ) — सिंचाई द्रव का अवशोषण; निकट निगरानी की आवश्यकता हो सकती है।",
                "gu": "TUR સિન્ડ્રોમ (દુર્લભ) — સિંચાઈ પ્રવાહીનું શોષણ; નજીકથી નિરીક્ષણની જરૂર પડી શકે છે.",
            },
        ],
        "alternatives": {
            "en": "Medical therapy (alpha-blockers, 5-ARIs), HoLEP, GreenLight laser (PVP), prostatic artery embolisation, or watchful waiting.",
            "hi": "औषधीय उपचार (अल्फा-ब्लॉकर्स, 5-ARI), HoLEP, ग्रीनलाइट लेज़र (PVP), प्रोस्टेट धमनी एम्बोलाइज़ेशन, या निगरानी।",
            "gu": "ઔષધ સારવાર (આલ્ફા-બ્લોકર્સ, 5-ARI), HoLEP, ગ્રીનલાઇટ લેઝર (PVP), પ્રોસ્ટેટ ધમની એમ્બોલાઇઝેશન, અથવા નિરીક્ષણ.",
        },
    },
    {
        "key": "turbt",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": {
            "en": "Transurethral Resection of Bladder Tumour (TURBT)",
            "hi": "मूत्राशय ट्यूमर का ट्रांस-यूरेथ्रल रिसेक्शन (TURBT)",
            "gu": "મૂત્રાશય ગાંઠનું ટ્રાન્સ-યુરેથ્રલ રિસેક્શન (TURBT)",
        },
        "procedure": {
            "en": "Endoscopic resection of bladder tumour through the urethra; tissue sent for histopathology to plan further treatment.",
            "hi": "मूत्रमार्ग के माध्यम से मूत्राशय के ट्यूमर का एंडोस्कोपिक रिसेक्शन; आगे के इलाज की योजना बनाने के लिए ऊतक हिस्टोपैथोलॉजी के लिए भेजा जाता है।",
            "gu": "મૂત્રમાર્ગ દ્વારા મૂત્રાશયના ટ્યુમરનું એન્ડોસ્કોપિક રિસેક્શન; આગળની સારવારનું આયોજન કરવા માટે પેશી હિસ્ટોપેથોલોજી માટે મોકલવામાં આવે છે.",
        },
        "specific_risks": [
            {"en": "Bladder perforation (1–5%) — may need catheter or rarely open repair.",
             "hi": "ब्लैडर परफॉरेशन (1–5%) — इसमें कैथेटर या, दुर्लभ मामलों में, ओपन रिपेयर (open repair) की ज़रूरत पड़ सकती है।",
             "gu": "બ્લેડર પર્ફોરેશન (1–5%) — તેમાં કેથેટર અથવા ભાગ્યે જ ઓપન રિપેર (open repair)ની જરૂર પડી શકે છે."},
            {"en": "Tumour recurrence — most bladder tumours recur and need surveillance cystoscopy.",
             "hi": "ट्यूमर पुनरावृत्ति — अधिकांश मूत्राशय ट्यूमर वापस आ जाते हैं, और इनके लिए निगरानी सिस्टोस्कोपी की ज़रूरत होती है।",
             "gu": "ગાંઠ ફરી થવી — મોટાભાગની મૂત્રાશય ગાંઠો ફરી થાય છે; નિરીક્ષણ સિસ્ટોસ્કોપી જરૂરી."},
            {"en": "Need for further treatment (intravesical BCG/chemo, repeat resection, radical cystectomy) based on pathology.",
             "hi": "पैथोलॉजी के आधार पर आगे के उपचार की आवश्यकता (इंट्रावेसिकल BCG/कीमो, पुनः उच्छेदन, रेडिकल सिस्टेक्टोमी)।",
             "gu": "પેથોલોજી અનુસાર આગળની સારવારની જરૂરિયાત (ઇન્ટ્રાવેસિકલ BCG/કેમો, ફરી કાપણ, રેડિકલ સિસ્ટેક્ટોમી)."},
            {"en": "Catheterisation for 1–3 days; transient haematuria common.",
             "hi": "1–3 दिनों तक कैथेटर; अल्पकालिक रक्तमूत्र सामान्य है।",
             "gu": "1–3 દિવસ માટે કેથેટર; થોડા સમય માટે રક્તમૂત્ર સામાન્ય છે."},
        ],
        "alternatives": {
            "en": "Surveillance alone (only if biopsy-confirmed indolent), radical cystectomy for high-grade muscle-invasive disease.",
            "hi": "केवल निगरानी (केवल यदि बायोप्सी से धीमी पुष्टि), उच्च-श्रेणी मांसपेशी-आक्रामक रोग के लिए रेडिकल सिस्टेक्टोमी।",
            "gu": "માત્ર નિરીક્ષણ (ફક્ત જો બાયોપ્સીથી ધીમી પુષ્ટિ), ઉચ્ચ-ગ્રેડ સ્નાયુ-આક્રમક રોગ માટે રેડિકલ સિસ્ટેક્ટોમી.",
        },
    },
    {
        "key": "urs_dj",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": {
            "en": "Ureterorenoscopy with DJ Stenting (URS + DJ)",
            "hi": "DJ स्टेंटिंग के साथ यूरेटेरोरेनोस्कोपी (URS + DJ)",
            "gu": "DJ સ્ટેન્ટિંગ સાથે યુરેટેરોરેનોસ્કોપી (URS + DJ)",
        },
        "procedure": {
            "en": "Endoscopic visualisation of ureter via urethra/bladder, stone fragmentation by laser or pneumatic lithotripsy, and placement of a temporary DJ stent.",
            "hi": "मूत्रमार्ग/मूत्राशय द्वारा यूरेटर का एंडोस्कोपिक अवलोकन, लेज़र या न्यूमेटिक लिथोट्रिप्सी से पथरी का विखंडन, और अस्थायी DJ स्टेंट लगाना।",
            "gu": "મૂત્રમાર્ગ/મૂત્રાશય દ્વારા યુરેટરનું એન્ડોસ્કોપિક નિરીક્ષણ, લેઝર અથવા ન્યુમેટિક લિથોટ્રિપ્સીથી પથરી તોડવી, અને ટૂંકા સમય માટે DJ સ્ટેન્ટ મૂકવો.",
        },
        "specific_risks": [
            {"en": "Ureteric injury / perforation (rare) — may need extended stenting or further surgery.",
             "hi": "यूरेटर में चोट / परफॉरेशन (दुर्लभ) — लंबे समय तक स्टेंटिंग या आगे की सर्जरी की आवश्यकता हो सकती है।",
             "gu": "યુરેટરને ઈજા / પરફોર્મેશન (દુર્લભ) — લાંબા સમય સુધી સ્ટેન્ટિંગ અથવા આગળની સર્જરીની જરૂર પડી શકે છે."},
            {"en": "Residual stone fragments — may need a 2nd procedure.",
             "hi": "बचे हुए पथरी के टुकड़े — दूसरी प्रक्रिया की आवश्यकता हो सकती है।",
             "gu": "બાકી રહેલા પથરીના ટુકડા — બીજી પ્રક્રિયા જરૂરી પડી શકે છે."},
            {"en": "Stent-related symptoms — burning, frequency, mild flank pain until stent removal (2–4 weeks).",
             "hi": "स्टेंट संबंधी लक्षण — स्टेंट निकालने तक (2–4 सप्ताह) जलन, बार-बार मूत्र, हल्का पार्श्व दर्द।",
             "gu": "સ્ટેન્ટ-સંબંધિત લક્ષણો — સ્ટેન્ટ દૂર થાય ત્યાં સુધી (2–4 અઠવાડિયા) બળતરા, વારંવાર પેશાબ, હળવો બાજુનો દુખાવો."},
            {"en": "Conversion to PCNL if stone too large or inaccessible.",
             "hi": "यदि पथरी बहुत बड़ी या दुर्गम — PCNL में रूपांतरण।",
             "gu": "જો પથરી ઘણી મોટી હોય અથવા પહોંચી શકાય તેવી ન હોય — PCNL માં રૂપાંતર."},
        ],
        "alternatives": {
            "en": "ESWL for select sizes/locations, PCNL for large stones, observation for small asymptomatic stones.",
            "hi": "चयनित आकार/स्थान के लिए ESWL, बड़ी पथरी के लिए PCNL, छोटी लक्षणहीन पथरी के लिए अवलोकन।",
            "gu": "પસંદ કરેલ માપ/સ્થાન માટે ESWL, મોટી પથરી માટે PCNL, નાની લક્ષણ વગરની પથરી માટે નિરીક્ષણ.",
        },
    },
    {
        "key": "rirs",
        "category": "Endourology",
        "anesthesia": "ga",
        "name": {
            "en": "Retrograde Intra-Renal Surgery (RIRS)",
            "hi": "रेट्रोग्रेड इंट्रा-रीनल सर्जरी (RIRS)",
            "gu": "રેટ્રોગ્રેડ ઇન્ટ્રા-રીનલ સર્જરી (RIRS)",
        },
        "procedure": {
            "en": "Use of a flexible ureteroscope to reach the kidney via the urethra and fragment stones with holmium laser. No skin incision.",
            "hi": "मूत्रमार्ग के माध्यम से किडनी तक पहुँचने के लिए flexible ureteroscope का उपयोग, और Holmium laser से पथरी को तोड़ना। कोई त्वचा चीरा नहीं।",
            "gu": "મૂત્રમાર્ગ દ્વારા કિડની સુધી પહોંચવા માટે flexible ureteroscope નો ઉપયોગ, અને Holmium laser થી પથરી તોડવી. કોઈ ત્વચા કાપ નથી.",
        },
        "specific_risks": [
            {"en": "Residual fragments / need for 2nd RIRS (10–20% in stones > 1.5 cm).",
             "hi": "बचे हुए टुकड़े / 2nd RIRS की आवश्यकता (1.5 cm से बड़े पत्थरों में 10–20%)।",
             "gu": "બાકી રહેલા ટુકડા / બીજી RIRSની જરૂર (1.5 cm કરતાં મોટી પથરીમાં 10–20%)."},
            {"en": "Post-op sepsis / fever — may need ICU care; pre-op culture & antibiotics minimise risk.",
             "hi": "पोस्ट-ऑप सेप्सिस / बुखार — ICU देखभाल की आवश्यकता हो सकती है; प्री-ऑप कल्चर और एंटीबायोटिक्स इस जोखिम को कम करते हैं।",
             "gu": "ઑપરેશન બાદ સેપ્સિસ / તાવ — ICU સંભાળ જરૂરી પડી શકે છે. ઑપરેશન પહેલાં કલ્ચર અને એન્ટિબायोटિક્સ આ જોખમ ઓછું કરે છે. ઑપરેશન પહેલાં કલ્ચર અને એન્ટિબायोटિક્સ આ જોખમ ઓછું કરે છે."},
            {"en": "DJ stent placement — usually for 2–4 weeks.",
             "hi": "DJ स्टेंट लगाना — आमतौर पर 2–4 सप्ताह के लिए।",
             "gu": "DJ સ્ટેન્ટ મૂકવો — સામાન્ય રીતે 2–4 અઠવાડિયા માટે."},
            {"en": "Ureteric injury (rare) — may need open repair.",
             "hi": "यूरेटर चोट (दुर्लभ) — खुली मरम्मत की आवश्यकता हो सकती है।",
             "gu": "યુરેટર ઈજા (દુર્લભ) — ખુલ્લી મરામતની જરૂર પડી શકે છે."},
        ],
        "alternatives": {
            "en": "ESWL, PCNL (preferred for stones > 2 cm), open / laparoscopic pyelolithotomy in select cases.",
            "hi": "ESWL, PCNL (2 सेमी से बड़ी पथरी के लिए पसंदीदा), चयनित मामलों में खुली/लैप्रोस्कोपिक पाइलोलिथोटोमी।",
            "gu": "ESWL, PCNL (2 સેમીથી મોટી પથરી માટે પસંદગીની), પસંદ કરેલા કેસોમાં ખુલ્લી/લેપ્રોસ્કોપિક પાયલોલિથોટોમી.",
        },
    },
    {
        "key": "pcnl",
        "category": "Endourology",
        "anesthesia": "ga",
        "name": {
            "en": "Percutaneous Nephrolithotomy (PCNL)",
            "hi": "पर्क्यूटेनियस नेफ्रोलिथोटोमी (PCNL)",
            "gu": "પર્ક્યુટેનિયસ નેફ્રોલિથોટોમી (PCNL)",
        },
        "procedure": {
            "en": "A small skin puncture (~1 cm) in the back is used to create a tract to the kidney through which stones are fragmented and removed. A nephrostomy tube and/or DJ stent may be left.",
            "hi": "पीठ पर लगभग 1 सेमी का छोटा त्वचा छेद बनाकर किडनी तक एक रास्ता बनाया जाता है; पथरी विखंडित कर निकाली जाती है। नेफ्रोस्टॉमी ट्यूब और/या DJ स्टेंट लगाया जा सकता है।",
            "gu": "પીઠ પર આશરે 1 સેમીનો નાનો ત્વચા છિદ્ર બનાવી કિડની સુધી માર્ગ બનાવાય છે; પથરી તોડીને દૂર કરાય છે. નેફ્રોસ્ટોમી ટ્યુબ અને/અથવા DJ સ્ટેન્ટ મુકાય શકે છે.",
        },
        "specific_risks": [
            {"en": "Significant bleeding (2–6%) — may require blood transfusion, embolisation or rarely nephrectomy.",
             "hi": "महत्वपूर्ण रक्तस्राव (2–6%) — रक्त आधान, एम्बोलाइज़ेशन या दुर्लभ रूप से नेफ्रेक्टॉमी की आवश्यकता हो सकती है।",
             "gu": "નોંધપાત્ર રક્તસ્રાવ (2–6%) — રક્ત આધાન, એમ્બોલાઇઝેશન અથવા ભાગ્યે જ નેફ્રેક્ટોમી જરૂર પડી શકે છે."},
            {"en": "Sepsis / fever (5–10%) — pre-op culture and antibiotics reduce risk.",
             "hi": "सेप्सिस / बुखार (5–10%) — पूर्व-ऑप कल्चर और एंटीबायोटिक जोखिम कम करते हैं।",
             "gu": "સેપ્સિસ / તાવ (5–10%) — ઑપરેશન પૂર્વે કલ્ચર અને એન્ટિબાયોટિક્સ જોખમ ઘટાડે છે."},
            {"en": "Pleural / lung injury for upper pole punctures — chest drain may be needed.",
             "hi": "upper pole punctures की वजह से pleural/फेफड़े में चोट लग सकती है — chest drain की ज़रूरत पड़ सकती है।",
             "gu": "upper pole punctures ને કારણે ફેફસાં/pleural ઈજા થઈ શકે છે — chest drain ની જરૂર પડી શકે છે."},
            {"en": "Residual fragments — may need 2nd PCNL or auxiliary RIRS/ESWL (~10–20%).",
             "hi": "बचे हुए टुकड़े — 2nd PCNL या सहायक RIRS/ESWL की आवश्यकता पड़ सकती है (~10–20%)।",
             "gu": "બાકી રહેલા ટુકડા — બીજી PCNL અથવા સહાયક RIRS/ESWL ની જરૂર પડી શકે છે (~10–20%)."},
            {"en": "Bowel / vascular / pelvic injury (very rare) — may need additional surgery.",
             "hi": "आंत / वैस्कुलर / पेल्विक चोट (बहुत दुर्लभ) — अतिरिक्त सर्जरी की ज़रूरत पड़ सकती है।",
             "gu": "આંતરડું / વેસ્ક્યુલર / પેલ્વિક ઈજા (ખૂબ દુર્લભ) — વધારાની સર્જરીની જરૂર પડી શકે છે."},
        ],
        "alternatives": {
            "en": "RIRS / Flex-URS for stones < 2 cm, ESWL for select cases, open / laparoscopic stone surgery rarely.",
            "hi": "< 2 सेमी पथरी हेतु RIRS / Flex-URS, चयनित मामलों में ESWL, दुर्लभ रूप से खुली/लैप्रोस्कोपिक पथरी सर्जरी।",
            "gu": "< 2 સેમી પથરી માટે RIRS / Flex-URS, પસંદગીના કેસોમાં ESWL, ભાગ્યે જ ખુલ્લી/લેપ્રોસ્કોપિક પથરી સર્જરી.",
        },
    },
    {
        "key": "mini_pcnl",
        "category": "Endourology",
        "anesthesia": "ga",
        "name": {
            "en": "Mini-PCNL",
            "hi": "मिनी-PCNL",
            "gu": "મિની-PCNL",
        },
        "procedure": {
            "en": "Same as PCNL but through a smaller tract (~14–18 Fr) for smaller stones — less bleeding, often tubeless, faster recovery.",
            "hi": "PCNL के समान लेकिन छोटे ट्रैक्ट (~14–18 Fr) से छोटी पथरी के लिए — कम रक्तस्राव, अक्सर बिना ट्यूब, तेज़ रिकवरी।",
            "gu": "PCNL જેવી જ પણ નાના ટ્રેક્ટ (~14–18 Fr) દ્વારા નાની પથરી માટે — ઓછું રક્તસ્રાવ, ઘણીવાર ટ્યુબ વગર, ઝડપી રિકવરી.",
        },
        "specific_risks": [
            {"en": "Bleeding lower than standard PCNL but still possible.",
             "hi": "मानक PCNL से कम रक्तस्राव लेकिन फिर भी संभव।",
             "gu": "સ્ટાન્ડર્ડ PCNL કરતાં રક્તસ્રાવ ઓછો હોય છે, પણ હજુ પણ શક્ય છે."},
            {"en": "Residual fragments slightly higher for large stones.",
             "hi": "बड़ी पथरी के लिए बचे टुकड़े थोड़े अधिक।",
             "gu": "મોટી પથરી માટે બાકી ટુકડા થોડા વધારે."},
            {"en": "Sepsis / fever as in standard PCNL.",
             "hi": "मानक PCNL की तरह सेप्सिस / बुखार।",
             "gu": "પ્રમાણિત PCNL જેવી જ સેપ્સિસ / તાવ."},
        ],
        "alternatives": {
            "en": "Standard PCNL, RIRS, ESWL.",
            "hi": "मानक PCNL, RIRS, ESWL।",
            "gu": "પ્રમાણિત PCNL, RIRS, ESWL.",
        },
    },
    {
        "key": "eswl",
        "category": "Endourology",
        "anesthesia": "sedation",
        "name": {
            "en": "Extracorporeal Shock Wave Lithotripsy (ESWL)",
            "hi": "एक्स्ट्राकॉर्पोरियल शॉक वेव लिथोट्रिप्सी (ESWL)",
            "gu": "એક્સ્ટ્રાકોર્પોરિયલ શૉક વેવ લિથોટ્રિપ્સી (ESWL)",
        },
        "procedure": {
            "en": "Externally focused shock waves break up kidney/ureteric stones non-invasively. Patient lies on a table; fragments pass with urine over the following days.",
            "hi": "बाह्य रूप से केंद्रित शॉक वेव्स किडनी/यूरेटर की पथरी को बिना चीर-फाड़ के तोड़ देती हैं। रोगी मेज पर लेटता है; अगले कुछ दिनों में टुकड़े मूत्र के साथ बाहर निकल जाते हैं।",
            "gu": "બાહ્ય રીતે કેન્દ્રિત શૉક વેવ્સ કિડની/યુરેટરની પથરીને ઓપરેશન વિના તોડી નાખે છે. દર્દી ટેબલ પર સૂવે છે; પછીના દિવસોમાં ટુકડા મૂત્ર સાથે નીકળી જાય છે.",
        },
        "specific_risks": [
            {"en": "Steinstrasse — stone fragments lined up in ureter, may need DJ / URS.",
             "hi": "स्टीनस्ट्रासे — यूरेटर में पथरी के टुकड़े जमे हुए, DJ / URS की आवश्यकता हो सकती है।",
             "gu": "સ્ટેઇનસ્ટ્રાસ્સે — યુરેટરમાં પથરીના ટુકડા જમા થવા, DJ / URS જરૂરી પડી શકે છે."},
            {"en": "Renal haematoma — usually small, resolves with rest.",
             "hi": "गुर्दे का हेमेटोमा — आमतौर पर छोटा, आराम से ठीक हो जाता है।",
             "gu": "કિડનીમાં હેમેટોમા — સામાન્ય રીતે નાનો, આરામથી રૂઝાય."},
            {"en": "Need for repeat sessions / additional surgery if stone doesn't break.",
             "hi": "यदि पथरी नहीं टूटे तो दोहराव सत्र / अतिरिक्त सर्जरी की आवश्यकता।",
             "gu": "જો પથરી તૂટે નહીં તો ફરી સત્રો / વધારાની સર્જરી જરૂરી."},
        ],
        "alternatives": {
            "en": "URS / RIRS, PCNL, observation for small stones.",
            "hi": "URS / RIRS, PCNL, छोटी पथरी के लिए निगरानी।",
            "gu": "URS / RIRS, PCNL, નાની પથરી માટે નિરીક્ષણ.",
        },
    },
    {
        "key": "cystoscopy_biopsy",
        "category": "Minor Procedure",
        "anesthesia": "spinal",
        "name": {
            "en": "Cystoscopy with Biopsy",
            "hi": "सिस्टोस्कोपी के साथ बायोप्सी",
            "gu": "સિસ્ટોસ્કોપી સાથે બાયોપ્સી",
        },
        "procedure": {
            "en": "Endoscopic inspection of the urethra and bladder via the urethra. Small tissue samples taken from suspicious areas and sent for histopathology.",
            "hi": "मूत्रमार्ग के माध्यम से मूत्रमार्ग और मूत्राशय का एंडोस्कोपिक निरीक्षण किया जाता है। संदिग्ध क्षेत्रों से छोटे ऊतक नमूने हिस्टोपैथोलॉजी हेतु भेजे जाते हैं।",
            "gu": "મૂત્રમાર્ગ દ્વારા મૂત્રમાર્ગ અને મૂત્રાશયનું એન્ડોસ્કોપિક નિરીક્ષણ કરવામાં આવે છે. શંકાસ્પદ વિસ્તારોમાંથી નાના પેશી નમૂના હિસ્ટોપેથોલોજી માટે મોકલવામાં આવે છે.",
        },
        "specific_risks": [
            {"en": "Transient haematuria, burning micturition for 1–2 days.",
             "hi": "अल्पकालिक रक्तमूत्र, 1–2 दिनों तक मूत्र में जलन।",
             "gu": "થોડા સમય માટે રક્તમૂત્ર, 1–2 દિવસ સુધી મૂત્રમાં બળતરા."},
            {"en": "UTI — may need short course of antibiotics.",
             "hi": "UTI — एंटीबायोटिक्स के छोटे कोर्स की आवश्यकता हो सकती है।",
             "gu": "UTI — ટૂંકા એન્ટિબાયોટિક કોર્સની જરૂર પડી શકે છે."},
            {"en": "Rarely urethral injury or bladder perforation.",
             "hi": "दुर्लभ रूप से मूत्रमार्ग चोट या मूत्राशय वेधन।",
             "gu": "ભાગ્યે જ મૂત્રમાર્ગ ઈજા અથવા મૂત્રાશય છિદ્ર."},
        ],
        "alternatives": {
            "en": "Imaging (CT urogram, MR urogram), urine cytology — these don't replace biopsy if a visible lesion is present.",
            "hi": "इमेजिंग (CT यूरोग्राम, MR यूरोग्राम), मूत्र साइटोलॉजी — दृश्य घाव हो तो बायोप्सी का विकल्प नहीं।",
            "gu": "ઇમેજિંગ (CT યુરોગ્રામ, MR યુરોગ્રામ), મૂત્ર સાયટોલોજી — જો દૃશ્યમાન જખમ હોય તો બાયોપ્સીનો વિકલ્પ નહીં.",
        },
    },
    {
        "key": "dviu",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": {
            "en": "Direct Visual Internal Urethrotomy (DVIU)",
            "hi": "डायरेक्ट विज़ुअल इंटरनल यूरेथ्रोटॉमी (DVIU)",
            "gu": "ડાયરેક્ટ વિઝ્યુઅલ ઇન્ટરનલ યુરેથ્રોટોમી (DVIU)",
        },
        "procedure": {
            "en": "Endoscopic incision of urethral stricture under direct vision with a cold knife or laser; catheter for 1–7 days.",
            "hi": "cold knife या laser से सीधी दृष्टि में urethral stricture का endoscopic incision; 1–7 दिनों तक catheter।",
            "gu": "cold knife અથવા laser વડે સીધી દ્રષ્ટિ હેઠળ urethral stricture નો endoscopic incision; 1–7 દિવસ માટે catheter.",
        },
        "specific_risks": [
            {"en": "Recurrence (~50% in 1 year) — may need repeat DVIU or urethroplasty.",
             "hi": "पुनरावृत्ति (1 वर्ष में ~50%) — दोबारा DVIU या यूरेथ्रोप्लास्टी की ज़रूरत पड़ सकती है।",
             "gu": "પુનરાવૃત્તિ (1 વર્ષમાં ~50%) — ફરી DVIU અથવા યુરેથ્રોપ્લાસ્ટીની જરૂર પડી શકે છે."},
            {"en": "Bleeding from incision site.",
             "hi": "चीरा स्थल से रक्तस्राव।",
             "gu": "કાપણ સ્થળેથી રક્તસ્રાવ."},
            {"en": "Urinary incontinence (rare).",
             "hi": "मूत्र असंयम (दुर्लभ)।",
             "gu": "મૂત્ર અસંયમ (દુર્લભ)."},
        ],
        "alternatives": {
            "en": "Urethral dilatation (less durable), urethroplasty (best for recurrent / long strictures), suprapubic catheterisation in selected cases.",
            "hi": "Urethral dilatation (कम टिकाऊ), urethroplasty (पुनरावर्ती/लंबे stricture के लिए सर्वोत्तम), चयनित मामलों में suprapubic catheterisation।",
            "gu": "Urethral dilatation (ઓછી ટકાઉ), urethroplasty (પુનરાવર્તિત/લાંબા stricture માટે શ્રેષ્ઠ), પસંદગીના કેસોમાં suprapubic catheterisation.",
        },
    },
    {
        "key": "spc",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": {
            "en": "Suprapubic Cystostomy (SPC)",
            "hi": "सुप्रापुबिक सिस्टोस्टॉमी (SPC)",
            "gu": "સુપ્રાપ્યુબિક સિસ્ટોસ્ટોમી (SPC)",
        },
        "procedure": {
            "en": "Placement of a urinary catheter directly into the bladder through the lower abdominal wall under local anaesthesia and ultrasound / cystoscopic guidance.",
            "hi": "स्थानीय एनेस्थीसिया एवं अल्ट्रासाउंड/सिस्टोस्कोपिक मार्गदर्शन में निचली पेट की दीवार से मूत्राशय में सीधे मूत्र कैथेटर लगाना।",
            "gu": "સ્થાનિક એનેસ્થેસિયા અને અલ્ટ્રાસાઉન્ડ/સિસ્ટોસ્કોપિક માર્ગદર્શન હેઠળ નીચલા પેટની દિવાલમાંથી મૂત્રાશયમાં સીધો મૂત્ર કેથેટર મૂકવો.",
        },
        "specific_risks": [
            {"en": "Bowel injury (rare with ultrasound guidance).",
             "hi": "आंत चोट (अल्ट्रासाउंड मार्गदर्शन के साथ दुर्लभ)।",
             "gu": "આંતરડું ઈજા (અલ્ટ્રાસાઉન્ડ માર્ગદર્શન સાથે દુર્લભ)."},
            {"en": "Catheter blockage / dislodgement — needs replacement.",
             "hi": "कैथेटर अवरोध / विस्थापन — प्रतिस्थापन आवश्यक।",
             "gu": "કેથેટર અવરોધ / સ્થાનભ્રંશ — ફેરબદલ જરૂરી."},
            {"en": "Local infection at tube site.",
             "hi": "ट्यूब स्थल पर स्थानीय संक्रमण।",
             "gu": "ટ્યુબ સ્થળે સ્થાનિક ચેપ."},
        ],
        "alternatives": {
            "en": "Per-urethral catheterisation (if not contraindicated), clean intermittent catheterisation.",
            "hi": "पेर-यूरेथ्रल कैथेटराइज़ेशन (यदि contraindicated न हो), क्लीन इंटरमिटेंट कैथेटराइज़ेशन।",
            "gu": "પેર-યુરેથ્રલ કેથેટરાઇઝેશન (જો contraindicated ન હોય), ક્લિન ઇન્ટરમિટન્ટ કેથેટરાઇઝેશન.",
        },
    },
]


# This file is intentionally split into two halves. We keep the first
# 10 procedures inlined above (the highest-volume endourology cases)
# and import the remaining 40 from `consent_procedures_part2.py` to
# keep each module under 1000 lines for code-review friendliness.
from .consent_procedures_part2 import PROCEDURES_PART2  # noqa: E402

PROCEDURES.extend(PROCEDURES_PART2)


PROCEDURES_BY_KEY: Dict[str, Dict[str, Any]] = {p["key"]: p for p in PROCEDURES}
